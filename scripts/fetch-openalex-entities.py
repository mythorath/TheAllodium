#!/usr/bin/env python3
"""Consolidate OpenAlex small entities from the public JSONL snapshot.

`fetch-authority-sources.py` is deliberately a bounded single-URL downloader:
it never discovers URLs and never unpacks archives. The OpenAlex snapshot
needs both, because each entity is published as many `updated_date=` partitions
that must be reduced latest-wins into one file per entity. That acquisition
step lives here, and it stops at the normalizer's input contract: the output is
OpenAlex-shaped JSONL, not authority rows.

Only the fields `normalize-authority-sources.py` actually reads are retained,
so a 335 MiB compressed entity reduces to a file small enough to sort in
memory downstream. Works and authors are out of scope by construction.
"""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Any, Iterator
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree


BUCKET_ORIGIN = "https://openalex.s3.amazonaws.com"
S3_NAMESPACE = "{http://s3.amazonaws.com/doc/2006-03-01/}"
USER_AGENT = "TheAllodium-openalex-consolidate/1 (+https://theallodium.org/about)"

# Exactly the raw keys read by normalize_openalex(), plus `id` and the
# `merge_into_id` marker used to drop entities merged into another record.
PROJECTED_FIELDS = {
    "publishers": (
        "id", "display_name", "name", "alternate_titles", "country_codes",
        "hierarchy_level", "parent_publisher", "works_count", "cited_by_count",
    ),
    "sources": (
        "id", "display_name", "name", "issn_l", "issn", "issns",
        "host_organization", "publisher_id", "publisher", "type", "source_type",
        "is_oa", "is_in_doaj", "works_count", "cited_by_count", "homepage_url",
    ),
    "institutions": (
        "id", "display_name", "name", "ror", "country_code", "type",
        "institution_type", "lineage", "parent_institution_id", "works_count",
        "cited_by_count",
    ),
    "domains": ("id", "display_name", "name", "description", "works_count", "cited_by_count"),
    "fields": (
        "id", "display_name", "name", "description", "works_count",
        "cited_by_count", "domain", "domain_id",
    ),
    "subfields": (
        "id", "display_name", "name", "description", "works_count",
        "cited_by_count", "field", "field_id",
    ),
    "topics": (
        "id", "display_name", "name", "description", "works_count",
        "cited_by_count", "subfield", "subfield_id", "keywords",
    ),
}
ENTITIES = tuple(PROJECTED_FIELDS)


def open_url(url: str, timeout: float, attempts: int = 4) -> Any:
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"}
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except (TimeoutError, urllib.error.URLError) as error:
            last_error = error
            if attempt + 1 == attempts:
                break
            time.sleep(min(2 ** attempt, 16))
    assert last_error is not None
    raise last_error


def list_partition_keys(entity: str, timeout: float) -> list[str]:
    """Every `part_*.gz` key for one entity, following continuation tokens."""
    keys: list[str] = []
    token: str | None = None
    while True:
        query = {"list-type": "2", "prefix": f"data/jsonl/{entity}/"}
        if token:
            query["continuation-token"] = token
        with open_url(f"{BUCKET_ORIGIN}/?{urllib.parse.urlencode(query)}", timeout) as response:
            tree = ElementTree.fromstring(response.read())
        for contents in tree.findall(f"{S3_NAMESPACE}Contents"):
            key = contents.findtext(f"{S3_NAMESPACE}Key") or ""
            if key.endswith(".gz"):
                keys.append(key)
        if (tree.findtext(f"{S3_NAMESPACE}IsTruncated") or "").lower() != "true":
            break
        token = tree.findtext(f"{S3_NAMESPACE}NextContinuationToken")
        if not token:
            break
    if not keys:
        raise ValueError(f"{entity}: no part files found under data/jsonl/{entity}/")
    return sorted(keys)


def download_part(key: str, destination: Path, timeout: float) -> str:
    """Fetch one part to a cached path, returning its SHA-256."""
    if destination.exists():
        return sha256_file(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{destination.name}.", dir=destination.parent
    )
    try:
        with os.fdopen(descriptor, "wb") as output:
            with open_url(f"{BUCKET_ORIGIN}/{urllib.parse.quote(key)}", timeout) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    return sha256_file(destination)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def partition_date(key: str) -> str:
    for part in key.split("/"):
        if part.startswith("updated_date="):
            return part.removeprefix("updated_date=")
    return ""


def read_records(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path.name}:{line_number}: invalid JSON") from error
            if not isinstance(record, dict):
                raise ValueError(f"{path.name}:{line_number}: expected a JSON object")
            yield record


def project(entity: str, record: dict[str, Any]) -> dict[str, Any]:
    return {
        field: record[field]
        for field in PROJECTED_FIELDS[entity]
        if field in record and record[field] is not None
    }


def consolidate(
    entity: str,
    raw_dir: Path,
    output_dir: Path,
    timeout: float,
) -> dict[str, Any]:
    """Reduce every partition for one entity into one latest-wins JSONL file."""
    keys = list_partition_keys(entity, timeout)
    # An id can reappear in several partitions; the newest updated_date is
    # current. Ties fall back to key order, which is stable and sorted.
    latest: dict[str, tuple[str, str, dict[str, Any]]] = {}
    merged_away = 0
    part_digests: list[dict[str, str]] = []

    for key in keys:
        local = raw_dir / entity / key.split("data/jsonl/")[-1].replace("/", "__")
        digest = download_part(key, local, timeout)
        part_digests.append({"key": key, "sha256": digest})
        date = partition_date(key)
        for record in read_records(local):
            identifier = record.get("id")
            if isinstance(identifier, dict):
                identifier = identifier.get("id")
            if not identifier:
                continue
            identifier = str(identifier)
            if record.get("merge_into_id"):
                # A merged entity is superseded, not current. Record the
                # tombstone so a stale earlier partition cannot resurrect it.
                previous = latest.get(identifier)
                if previous is None or (date, key) >= previous[:2]:
                    latest[identifier] = (date, key, {})
                    merged_away += 1
                continue
            previous = latest.get(identifier)
            if previous is not None and (date, key) < previous[:2]:
                continue
            if previous is not None and not previous[2]:
                merged_away -= 1
            latest[identifier] = (date, key, project(entity, record))

    rows = [
        entry[2] for _, entry in sorted(latest.items(), key=lambda item: item[0])
        if entry[2]
    ]
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"openalex_{entity}.jsonl"
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{output_path.name}.", dir=output_dir
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
                stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output_path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise

    return {
        "entity": entity,
        "source_url": f"s3://openalex/data/jsonl/{entity}/",
        "partitions": len(keys),
        "partition_sha256": part_digests,
        "distinct_ids": len(latest),
        "merged_or_deleted": merged_away,
        "rows": len(rows),
        "output": output_path.name,
        "output_sha256": sha256_file(output_path),
        "output_bytes": output_path.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--entity", action="append", choices=ENTITIES, default=[],
        help="Entity to consolidate; repeat. Defaults to all seven.",
    )
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    entities = tuple(dict.fromkeys(args.entity)) or ENTITIES

    report = []
    for entity in entities:
        summary = consolidate(entity, args.raw_dir, args.output_dir, args.timeout)
        report.append(summary)
        print(
            f"{entity}: {summary['rows']} rows from {summary['partitions']} partitions "
            f"({summary['output_bytes'] / 1048576:.1f} MiB)",
            flush=True,
        )
    print(json.dumps({"entities": report}, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, urllib.error.URLError) as error:
        raise SystemExit(f"error: {error}") from error
