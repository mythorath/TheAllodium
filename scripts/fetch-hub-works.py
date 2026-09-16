#!/usr/bin/env python3
"""Fetch top cited and recent OpenAlex works for every taxonomy hub.

One polite-pool request per node per sort against the OpenAlex works API.
Results land in resumable JSONL, then load into AUTHORITY.hub_works and
hub_work_records the same way generate_federated_overviews.py loads D1.

Never request or store abstract_inverted_index (federation contract §8).

Usage:
    python3 scripts/fetch-hub-works.py --jsonl /tmp/hub-works.jsonl --dry-run --limit 4
    python3 scripts/fetch-hub-works.py --jsonl /tmp/hub-works.jsonl --env staging
    python3 scripts/fetch-hub-works.py --jsonl /tmp/hub-works.jsonl --load-only --env production --yes
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAILTO = os.environ.get("FEDERATION_CONTACT_EMAIL", "index@theallodium.org")
DEFAULT_API_BASE = "https://api.openalex.org"
USER_AGENT = "TheAllodium-hub-works/1 (https://theallodium.org; mailto:{mailto})"
WORKS_PER_RANK = 6
HUB_KINDS = ("domain", "field", "subfield", "topic")
RANK_KINDS = ("cited", "recent")
FILTER_BY_KIND = {
    "domain": "primary_topic.domain.id",
    "field": "primary_topic.field.id",
    "subfield": "primary_topic.subfield.id",
    "topic": "primary_topic.id",
}
SORT_BY_RANK = {
    "cited": "cited_by_count:desc",
    "recent": "publication_date:desc",
}
# Only fields needed to populate hub_work_records. abstract_inverted_index is
# banned: it is a machine-readable abstract substitute.
SELECT_FIELDS = (
    "id",
    "doi",
    "title",
    "display_name",
    "authorships",
    "publication_year",
    "publication_date",
    "primary_location",
    "type",
    "open_access",
    "cited_by_count",
)
FORBIDDEN_FIELDS = frozenset({"abstract", "abstract_inverted_index", "inverted_abstract"})
MAX_RETRY_SLEEP = 60
BUDGET_RETRY_AFTER = 300


class OpenAlexBudgetError(RuntimeError):
    """OpenAlex daily request budget is exhausted; JSONL remains resumable."""
DOI_PREFIX = re.compile(r"^https?://(?:dx\.)?doi\.org/", re.I)
DOI_LABEL = re.compile(r"^doi:\s*", re.I)
OPENALEX_PREFIX = re.compile(r"^https?://openalex\.org/", re.I)

for _field in SELECT_FIELDS:
    if _field in FORBIDDEN_FIELDS or "abstract" in _field:
        raise RuntimeError(f"refusing to select forbidden OpenAlex field {_field}")


def sql_value(value: Any) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "'" + str(value).replace("'", "''") + "'"


def normalize_doi(value: str) -> str:
    text = (value or "").strip()
    try:
        text = urllib.parse.unquote(text)
    except Exception:
        pass
    text = DOI_LABEL.sub("", text)
    text = DOI_PREFIX.sub("", text)
    return text.strip().rstrip(")]}>.,;:").lower()


def openalex_short_id(value: str) -> str:
    text = value.strip()
    text = OPENALEX_PREFIX.sub("", text)
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    return text


def safe_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("OpenAlex URLs must use HTTPS and include a hostname")
    if parsed.username or parsed.password:
        raise ValueError("credentials are prohibited in OpenAlex URLs")
    return value


def filter_attribute(hub_kind: str) -> str:
    if hub_kind == "domain":
        return FILTER_BY_KIND["domain"]
    if hub_kind == "field":
        return FILTER_BY_KIND["field"]
    if hub_kind == "subfield":
        return FILTER_BY_KIND["subfield"]
    if hub_kind == "topic":
        return FILTER_BY_KIND["topic"]
    raise ValueError(f"unknown hub_kind: {hub_kind}")


def sort_for_rank(rank_kind: str) -> str:
    if rank_kind == "cited":
        return SORT_BY_RANK["cited"]
    if rank_kind == "recent":
        return SORT_BY_RANK["recent"]
    raise ValueError(f"unknown rank_kind: {rank_kind}")


def job_key(hub_kind: str, hub_id: str, rank_kind: str) -> tuple[str, str, str]:
    return (hub_kind, hub_id, rank_kind)


def build_works_url(
    *,
    hub_kind: str,
    hub_id: str,
    rank_kind: str,
    mailto: str,
    per_page: int = WORKS_PER_RANK,
    api_base: str = DEFAULT_API_BASE,
) -> str:
    select = ",".join(SELECT_FIELDS)
    if any(field in select.split(",") for field in FORBIDDEN_FIELDS) or "abstract" in select:
        raise RuntimeError("refusing to request abstract fields from OpenAlex")
    params = {
        "filter": (
            f"{filter_attribute(hub_kind)}:{openalex_short_id(hub_id)},"
            "has_doi:true,type:article"
        ),
        "sort": sort_for_rank(rank_kind),
        "per_page": str(per_page),
        "select": select,
        "mailto": mailto,
    }
    return safe_url(f"{api_base.rstrip('/')}/works?{urllib.parse.urlencode(params)}")


def _authors(authorships: Any) -> list[dict[str, str | None]]:
    authors: list[dict[str, str | None]] = []
    if not isinstance(authorships, list):
        return authors
    for entry in authorships:
        if not isinstance(entry, dict):
            continue
        author = entry.get("author") if isinstance(entry.get("author"), dict) else {}
        name = str((author or {}).get("display_name") or "").strip()
        if not name:
            continue
        orcid = (author or {}).get("orcid")
        authors.append({"name": name, "orcid": str(orcid) if orcid else None})
    return authors


def _container_title(primary_location: Any) -> str | None:
    if not isinstance(primary_location, dict):
        return None
    source = primary_location.get("source")
    if isinstance(source, dict):
        name = str(source.get("display_name") or "").strip()
        if name:
            return name
    return None


def _canonical_url(primary_location: Any, doi: str) -> str | None:
    if isinstance(primary_location, dict):
        landing = str(primary_location.get("landing_page_url") or "").strip()
        if landing:
            return landing
    if doi:
        return f"https://doi.org/{doi}"
    return None


def _is_open_access(open_access: Any) -> int | None:
    if not isinstance(open_access, dict) or "is_oa" not in open_access:
        return None
    value = open_access.get("is_oa")
    if value is None:
        return None
    return 1 if value else 0


def map_work(record: dict[str, Any], fetched_at: str) -> dict[str, Any] | None:
    """Project an OpenAlex work onto hub_work_records columns only."""
    doi = normalize_doi(str(record.get("doi") or ""))
    title = str(record.get("title") or record.get("display_name") or "").strip()
    if not doi or not title:
        return None
    mapped = {
        "doi": doi,
        "title": title,
        "authors_json": _authors(record.get("authorships")),
        "publication_year": record.get("publication_year"),
        "publication_date": record.get("publication_date") or None,
        "container_title": _container_title(record.get("primary_location")),
        "work_type": record.get("type") or None,
        "is_open_access": _is_open_access(record.get("open_access")),
        "cited_by_count": record.get("cited_by_count"),
        "canonical_url": _canonical_url(record.get("primary_location"), doi),
        "openalex_id": record.get("id") or None,
        "fetched_at": fetched_at,
    }
    if FORBIDDEN_FIELDS.intersection(mapped):
        raise RuntimeError("mapped hub work unexpectedly contains abstract fields")
    return mapped


def load_completed_jobs(path: Path) -> set[tuple[str, str, str]]:
    completed: set[tuple[str, str, str]] = set()
    if not path.is_file():
        return completed
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            record = json.loads(line)
            completed.add(job_key(record["hub_kind"], record["hub_id"], record["rank_kind"]))
    return completed


def read_jobs(path: Path) -> list[dict[str, Any]]:
    latest: dict[tuple[str, str, str], dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            record = json.loads(line)
            latest[job_key(record["hub_kind"], record["hub_id"], record["rank_kind"])] = record
    return list(latest.values())


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def read_nodes_file(path: Path) -> list[tuple[str, str]]:
    nodes: list[tuple[str, str]] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            if not isinstance(record, dict):
                raise ValueError(f"{path}:{line_number}: expected a JSON object")
            kind = str(record.get("hub_kind") or "")
            hub_id = str(record.get("hub_id") or "").strip()
            if kind not in HUB_KINDS or not hub_id:
                raise ValueError(f"{path}:{line_number}: need hub_kind and hub_id")
            nodes.append((kind, hub_id))
    return nodes


def _wrangler_authority(env_name: str, local: bool) -> list[str]:
    args = ["npx", "wrangler", "d1", "execute", "AUTHORITY"]
    if local or env_name == "local":
        args += ["--local"]
    else:
        args += ["--env", env_name, "--remote"]
    return args


def _parse_wrangler_json(stdout: str) -> list[dict[str, Any]]:
    parsed = json.loads(stdout)
    rows = parsed[0].get("results") if parsed else []
    return [row for row in (rows or []) if isinstance(row, dict)]


def load_taxonomy_nodes(*, env_name: str, local: bool) -> list[tuple[str, str]]:
    nodes: list[tuple[str, str]] = []
    queries = (
        ("domain", "SELECT id FROM oa_domains ORDER BY id"),
        ("field", "SELECT id FROM oa_fields ORDER BY id"),
        ("subfield", "SELECT id FROM oa_subfields ORDER BY id"),
        ("topic", "SELECT id FROM oa_topics ORDER BY id"),
    )
    for kind, sql in queries:
        args = _wrangler_authority(env_name, local) + ["--json", "--command", sql, "--yes"]
        result = subprocess.run(args, cwd=ROOT, check=True, capture_output=True, text=True)
        for row in _parse_wrangler_json(result.stdout):
            hub_id = str(row.get("id") or "").strip()
            if hub_id:
                nodes.append((kind, hub_id))
    return nodes


def expand_jobs(nodes: Iterable[tuple[str, str]]) -> list[tuple[str, str, str]]:
    jobs: list[tuple[str, str, str]] = []
    for hub_kind, hub_id in nodes:
        for rank_kind in RANK_KINDS:
            jobs.append((hub_kind, hub_id, rank_kind))
    return jobs


def _read_limited(response: Any, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(min(64 * 1024, max_bytes - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"OpenAlex response exceeded --max-bytes ({max_bytes})")
        chunks.append(chunk)
    return b"".join(chunks)


def retry_sleep_seconds(retry_after: str | None, attempt: int) -> float:
    delay = min(2 ** attempt, 16)
    if not retry_after:
        return delay
    try:
        retry_seconds = float(retry_after)
    except ValueError:
        return delay
    if retry_seconds > BUDGET_RETRY_AFTER:
        raise OpenAlexBudgetError(
            f"OpenAlex Retry-After={int(retry_seconds)}s exceeds budget wait cap"
        )
    return max(delay, min(retry_seconds, MAX_RETRY_SLEEP))


def fetch_json(
    url: str,
    *,
    mailto: str,
    timeout: float,
    max_bytes: int,
    attempts: int = 4,
    opener: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    safe_url(url)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT.format(mailto=mailto),
            "Accept": "application/json",
        },
    )
    open_url = opener or urllib.request.urlopen
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with open_url(request, timeout=timeout) as response:
                payload = json.loads(_read_limited(response, max_bytes).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("OpenAlex response was not a JSON object")
            return payload
        except urllib.error.HTTPError as error:
            last_error = error
            retry_after = error.headers.get("Retry-After") if error.headers else None
            if error.code in {429, 500, 502, 503, 504} and attempt + 1 < attempts:
                delay = retry_sleep_seconds(retry_after, attempt)
                time.sleep(delay)
                continue
            if error.code == 429:
                retry_sleep_seconds(retry_after, attempt)
            raise
        except (TimeoutError, urllib.error.URLError, json.JSONDecodeError, ValueError) as error:
            last_error = error
            if attempt + 1 == attempts:
                break
            time.sleep(min(2 ** attempt, 16))
    assert last_error is not None
    raise last_error


def fetch_hub_job(
    *,
    hub_kind: str,
    hub_id: str,
    rank_kind: str,
    mailto: str,
    per_page: int,
    api_base: str,
    timeout: float,
    max_bytes: int,
    fetched_at: str,
    opener: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    url = build_works_url(
        hub_kind=hub_kind,
        hub_id=hub_id,
        rank_kind=rank_kind,
        mailto=mailto,
        per_page=per_page,
        api_base=api_base,
    )
    payload = fetch_json(
        url, mailto=mailto, timeout=timeout, max_bytes=max_bytes, opener=opener
    )
    works: list[dict[str, Any]] = []
    for record in payload.get("results") or []:
        if not isinstance(record, dict):
            continue
        mapped = map_work(record, fetched_at)
        if mapped:
            works.append(mapped)
        if len(works) >= per_page:
            break
    return {
        "hub_kind": hub_kind,
        "hub_id": hub_id,
        "rank_kind": rank_kind,
        "fetched_at": fetched_at,
        "works": works,
    }


def record_sql(work: dict[str, Any]) -> str:
    columns = (
        "doi", "title", "authors_json", "publication_year", "publication_date",
        "container_title", "work_type", "is_open_access", "cited_by_count",
        "canonical_url", "openalex_id", "fetched_at",
    )
    values = ", ".join(sql_value(work.get(column)) for column in columns)
    return (
        "INSERT OR REPLACE INTO hub_work_records "
        f"({', '.join(columns)}) VALUES ({values});"
    )


def link_sql(hub_kind: str, hub_id: str, rank_kind: str, rank: int, doi: str) -> str:
    return (
        "INSERT OR REPLACE INTO hub_works "
        "(hub_kind, hub_id, rank_kind, rank, doi) VALUES ("
        f"{sql_value(hub_kind)}, {sql_value(hub_id)}, {sql_value(rank_kind)}, "
        f"{sql_value(rank)}, {sql_value(doi)});"
    )


def job_sql(record: dict[str, Any]) -> list[str]:
    statements = [
        (
            "DELETE FROM hub_works WHERE hub_kind = "
            f"{sql_value(record['hub_kind'])} AND hub_id = {sql_value(record['hub_id'])} "
            f"AND rank_kind = {sql_value(record['rank_kind'])};"
        )
    ]
    for rank, work in enumerate(record.get("works") or [], 1):
        statements.append(record_sql(work))
        statements.append(
            link_sql(
                record["hub_kind"],
                record["hub_id"],
                record["rank_kind"],
                rank,
                work["doi"],
            )
        )
    return statements


def iter_sql_batches(records: Iterable[dict[str, Any]], batch_size: int) -> Iterator[list[str]]:
    batch: list[str] = []
    for record in records:
        for statement in job_sql(record):
            batch.append(statement)
            if len(batch) >= batch_size:
                yield batch
                batch = []
    if batch:
        yield batch


def apply_sql(statements: Iterable[str], *, env_name: str, local: bool) -> None:
    sql = "\n".join(statements) + "\n"
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        suffix=".sql",
        prefix="hub-works-",
        delete=False,
    ) as handle:
        handle.write(sql)
        handle.flush()
        path = handle.name
    try:
        args = _wrangler_authority(env_name, local) + ["--file", path, "--yes"]
        subprocess.run(args, cwd=ROOT, check=True)
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jsonl", required=True, type=Path)
    parser.add_argument("--env", default="local", choices=("local", "staging", "production"))
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--load-only", action="store_true")
    parser.add_argument("--fetch-only", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--sleep", type=float, default=0.12)
    parser.add_argument("--mailto", default=DEFAULT_MAILTO)
    parser.add_argument("--per-page", type=int, default=WORKS_PER_RANK)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--max-bytes", type=int, default=2 * 1024 * 1024)
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--nodes-file", type=Path, default=None)
    parser.add_argument("--sql-out", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args(argv)

    if args.load_only and args.fetch_only:
        print("Refusing --load-only together with --fetch-only", file=sys.stderr)
        return 2
    if args.env == "production" and not args.yes and not args.dry_run and not args.fetch_only:
        print("Refusing production AUTHORITY writes without --yes", file=sys.stderr)
        return 2
    if args.per_page <= 0 or args.timeout <= 0 or args.max_bytes <= 0 or args.batch_size <= 0:
        parser.error("--per-page, --timeout, --max-bytes, and --batch-size must be positive")
    if args.sleep < 0:
        parser.error("--sleep must be >= 0")

    errors = 0
    if not args.load_only:
        if args.refresh and args.jsonl.exists():
            args.jsonl.unlink()
        completed = load_completed_jobs(args.jsonl)
        if args.nodes_file is not None:
            nodes = read_nodes_file(args.nodes_file)
        else:
            nodes = load_taxonomy_nodes(env_name=args.env, local=args.env == "local")
        jobs = [
            job for job in expand_jobs(nodes)
            if job not in completed
        ]
        if args.limit is not None:
            jobs = jobs[: args.limit]
        print(
            f"nodes={len(nodes)} completed={len(completed)} remaining={len(jobs)} "
            f"per_page={args.per_page}",
            flush=True,
        )
        for hub_kind, hub_id, rank_kind in jobs:
            try:
                record = fetch_hub_job(
                    hub_kind=hub_kind,
                    hub_id=hub_id,
                    rank_kind=rank_kind,
                    mailto=args.mailto,
                    per_page=args.per_page,
                    api_base=args.api_base,
                    timeout=args.timeout,
                    max_bytes=args.max_bytes,
                    fetched_at=utc_now(),
                )
                append_jsonl(args.jsonl, record)
                print(
                    f"{hub_kind}\t{hub_id}\t{rank_kind}\tok\tworks={len(record['works'])}",
                    flush=True,
                )
            except OpenAlexBudgetError:
                errors += 1
                print(
                    f"{hub_kind}\t{hub_id}\t{rank_kind}\tbudget\t"
                    "OpenAlex daily request budget exhausted; JSONL is resumable after midnight UTC",
                    flush=True,
                )
                break
            except Exception as exc:  # noqa: BLE001 — keep going; never print payloads
                errors += 1
                print(
                    f"{hub_kind}\t{hub_id}\t{rank_kind}\terror\t{type(exc).__name__}",
                    flush=True,
                )
            if args.sleep:
                time.sleep(args.sleep)

    if args.fetch_only:
        return 0 if errors == 0 else 1
    if not args.jsonl.is_file():
        print(f"missing JSONL {args.jsonl}", file=sys.stderr)
        return 1

    records = read_jobs(args.jsonl)
    statements = [statement for record in records for statement in job_sql(record)]
    if args.sql_out is not None:
        args.sql_out.write_text(
            "\n".join(statements) + ("\n" if statements else ""),
            encoding="utf-8",
        )
    print(f"jsonl_jobs={len(records)} sql_statements={len(statements)}", flush=True)
    if args.dry_run or not statements:
        return 0 if errors == 0 else 1
    for batch in iter_sql_batches(records, args.batch_size):
        apply_sql(batch, env_name=args.env, local=args.env == "local")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
