#!/usr/bin/env python3
"""Fetch explicitly selected, small public authority source files safely."""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any
import urllib.error
import urllib.parse
import urllib.request


SOURCES = {
    "openalex_publishers": {
        "env": "AUTHORITY_OPENALEX_PUBLISHERS_URL",
        "filename": "openalex-publishers.json",
        "source_name": "OpenAlex publishers",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openalex_sources": {
        "env": "AUTHORITY_OPENALEX_SOURCES_URL",
        "filename": "openalex-sources.json",
        "source_name": "OpenAlex sources",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openalex_institutions": {
        "env": "AUTHORITY_OPENALEX_INSTITUTIONS_URL",
        "filename": "openalex-institutions.json",
        "source_name": "OpenAlex institutions",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openalex_domains": {
        "env": "AUTHORITY_OPENALEX_DOMAINS_URL",
        "filename": "openalex-domains.json",
        "source_name": "OpenAlex domains",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openalex_fields": {
        "env": "AUTHORITY_OPENALEX_FIELDS_URL",
        "filename": "openalex-fields.json",
        "source_name": "OpenAlex fields",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openalex_subfields": {
        "env": "AUTHORITY_OPENALEX_SUBFIELDS_URL",
        "filename": "openalex-subfields.json",
        "source_name": "OpenAlex subfields",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openalex_topics": {
        "env": "AUTHORITY_OPENALEX_TOPICS_URL",
        "filename": "openalex-topics.json",
        "source_name": "OpenAlex topics",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "ror": {
        "env": "AUTHORITY_ROR_URL",
        "filename": "ror-release.zip",
        "source_name": "Research Organization Registry",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "retraction_watch": {
        "env": "AUTHORITY_RETRACTION_WATCH_URL",
        "filename": "retraction-watch.csv",
        "source_name": "Retraction Watch public data",
        "license_name": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
    },
    "doaj": {
        "env": "AUTHORITY_DOAJ_URL",
        "filename": "doaj-journals.csv",
        "source_name": "Directory of Open Access Journals",
        "license_name": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "nlm": {
        "env": "AUTHORITY_NLM_URL",
        "filename": "nlm-journals.xml",
        "source_name": "NLM Catalog journal data",
        "license_name": "NLM data terms",
        "license_url": "https://www.nlm.nih.gov/databases/download/terms_and_conditions.html",
    },
}
USER_AGENT = "TheAllodium-authority-fetch/1 (+https://theallodium.com)"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("source URLs must use HTTPS and include a hostname")
    if parsed.username or parsed.password:
        raise ValueError("credentials are prohibited in source URLs")
    return value


def download(url: str, destination: Path, max_bytes: int, timeout: float) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    descriptor, temporary = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    total = 0
    try:
        with os.fdopen(descriptor, "wb") as output:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                final_url = safe_url(response.geturl())
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > max_bytes:
                    raise ValueError(
                        f"server reports {content_length} bytes; --max-bytes is {max_bytes}"
                    )
                while True:
                    chunk = response.read(min(1024 * 1024, max_bytes - total + 1))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError(f"download exceeded --max-bytes ({max_bytes})")
                    output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if total == 0:
            raise ValueError("download was empty")
        os.replace(temporary, destination)
        return final_url
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def atomic_json(path: Path, document: Any) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(document, stream, ensure_ascii=False, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def resolve_url(name: str, cli_urls: dict[str, str]) -> str:
    value = cli_urls.get(name) or os.environ.get(str(SOURCES[name]["env"]))
    if not value:
        raise ValueError(
            f"no URL for {name}; pass --url {name}=https://... or set {SOURCES[name]['env']}"
        )
    return safe_url(value)


def parse_urls(values: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for value in values:
        name, separator, url = value.partition("=")
        if not separator or name not in SOURCES:
            raise ValueError(f"--url must be NAME=URL; NAME is one of {', '.join(SOURCES)}")
        result[name] = url
    return result


def convert_parquet(source: Path, destination: Path) -> None:
    try:
        parquet = importlib.import_module("pyarrow.parquet")
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "OpenAlex Parquet conversion requires pyarrow. Install it in an isolated "
            "environment (`python -m pip install pyarrow`), then rerun with "
            "--convert-parquet INPUT --parquet-output OUTPUT."
        ) from error
    descriptor, temporary = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            parquet_file = parquet.ParquetFile(source)
            for batch in parquet_file.iter_batches(batch_size=10_000):
                for record in batch.to_pylist():
                    stream.write(
                        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                    )
                    stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--source",
        action="append",
        choices=sorted(SOURCES),
        default=[],
        help="Dataset to fetch; repeat for multiple datasets.",
    )
    parser.add_argument(
        "--url",
        action="append",
        default=[],
        metavar="NAME=URL",
        help=(
            "Override a source URL. Environment alternatives: "
            + ", ".join(str(source["env"]) for source in SOURCES.values())
        ),
    )
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--convert-parquet", type=Path)
    parser.add_argument("--parquet-output", type=Path)
    args = parser.parse_args()
    if args.max_bytes <= 0 or args.timeout <= 0:
        parser.error("--max-bytes and --timeout must be positive")
    if bool(args.convert_parquet) != bool(args.parquet_output):
        parser.error("--convert-parquet and --parquet-output must be used together")
    if not args.source and not args.convert_parquet:
        parser.error("select at least one --source or use --convert-parquet")
    if len(set(args.source)) != len(args.source):
        parser.error("each --source may be selected only once")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    cli_urls = parse_urls(args.url)
    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    files = []
    for name in args.source:
        source = SOURCES[name]
        destination = args.output_dir / str(source["filename"])
        requested_url = resolve_url(name, cli_urls)
        resolved_url = download(requested_url, destination, args.max_bytes, args.timeout)
        files.append(
            {
                "dataset": name,
                "filename": destination.name,
                "source_name": source["source_name"],
                "source_url": requested_url,
                "resolved_url": resolved_url,
                "license_name": source["license_name"],
                "license_url": source["license_url"],
                "fetched_at": fetched_at,
                "sha256": sha256_file(destination),
                "bytes": destination.stat().st_size,
            }
        )
    if files:
        atomic_json(
            args.output_dir / "download-manifest.json",
            {"manifest_version": 1, "files": files},
        )
    if args.convert_parquet and args.parquet_output:
        args.parquet_output.parent.mkdir(parents=True, exist_ok=True)
        convert_parquet(args.convert_parquet, args.parquet_output)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, urllib.error.URLError) as error:
        raise SystemExit(f"error: {error}") from error
