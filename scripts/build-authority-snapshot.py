#!/usr/bin/env python3
"""Build deterministic, D1-importable authority SQL from normalized inputs."""

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Iterator


SCHEMA_VERSION = 1
SOURCE_MANIFEST = "authority-source-manifest.json"
FAMILY_FILES = {
    "openalex": (
        "openalex_publishers.jsonl",
        "openalex_sources.jsonl",
        "openalex_institutions.jsonl",
        "openalex_domains.jsonl",
        "openalex_fields.jsonl",
        "openalex_subfields.jsonl",
        "openalex_topics.jsonl",
    ),
    "ror": ("ror_organizations.jsonl",),
    "retraction_watch": ("retraction_watch_notices.csv",),
    "doaj": ("doaj_journals.jsonl",),
    "nlm": ("nlm_journals.jsonl",),
}
TABLES = {
    "openalex_publishers.jsonl": (
        "oa_publishers",
        "id",
        (
            "id", "display_name", "alternate_titles_json", "country_codes_json",
            "hierarchy_level", "parent_publisher_id", "works_count", "cited_by_count",
        ),
        {"alternate_titles_json": [], "country_codes_json": []},
        "openalex",
    ),
    "openalex_sources.jsonl": (
        "oa_sources",
        "id",
        (
            "id", "display_name", "issn_l", "issns_json", "host_organization_id",
            "publisher_id", "source_type", "is_oa", "is_in_doaj", "works_count",
            "cited_by_count", "homepage_url",
        ),
        {"issns_json": []},
        "openalex",
    ),
    "openalex_institutions.jsonl": (
        "oa_institutions",
        "id",
        (
            "id", "ror_id", "display_name", "country_code", "institution_type",
            "parent_institution_id", "works_count", "cited_by_count",
        ),
        {},
        "openalex",
    ),
    "openalex_domains.jsonl": (
        "oa_domains", "id",
        ("id", "display_name", "description", "works_count", "cited_by_count"),
        {}, "openalex",
    ),
    "openalex_fields.jsonl": (
        "oa_fields", "id",
        ("id", "domain_id", "display_name", "description", "works_count", "cited_by_count"),
        {}, "openalex",
    ),
    "openalex_subfields.jsonl": (
        "oa_subfields", "id",
        ("id", "field_id", "display_name", "description", "works_count", "cited_by_count"),
        {}, "openalex",
    ),
    "openalex_topics.jsonl": (
        "oa_topics", "id",
        (
            "id", "subfield_id", "display_name", "description", "keywords_json",
            "works_count", "cited_by_count",
        ),
        {"keywords_json": []}, "openalex",
    ),
    "ror_organizations.jsonl": (
        "ror_organizations", "id",
        (
            "id", "display_name", "organization_types_json", "country_code", "status",
            "established_year", "website_url", "aliases_json", "labels_json",
            "external_ids_json",
        ),
        {
            "organization_types_json": [], "aliases_json": [], "labels_json": [],
            "external_ids_json": {},
        },
        "ror",
    ),
    "retraction_watch_notices.csv": (
        "retraction_watch_notices", "id",
        (
            "id", "doi", "original_paper_doi", "title", "journal", "publisher",
            "notice_type", "notice_date", "original_paper_date", "reason_json",
        ),
        {"reason_json": []}, "retraction_watch",
    ),
    "doaj_journals.jsonl": (
        "doaj_journals", "id",
        (
            "id", "title", "issn", "eissn", "publisher", "country_code", "added_on",
            "last_updated", "seal", "license_json", "subjects_json",
        ),
        {"seal": 0, "license_json": [], "subjects_json": []}, "doaj",
    ),
    "nlm_journals.jsonl": (
        "nlm_journals", "nlm_id",
        (
            "nlm_id", "title", "abbreviation", "issn_print", "issn_electronic",
            "issn_linking", "publisher", "country", "language_json", "medline_ta",
        ),
        {"language_json": []}, "nlm",
    ),
}
DELETE_ORDER = (
    "oa_source_issns", "oa_topics", "oa_subfields", "oa_fields", "oa_domains",
    "oa_sources", "oa_institutions", "oa_publishers",
    "ror_organizations", "retraction_watch_notices", "doaj_journals",
    "nlm_journals", "authority_manifest",
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sql_value(value: Any) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        if not isinstance(value, bool) and isinstance(value, float) and not value.is_integer():
            return repr(value)
        return str(int(value))
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "'" + str(value).replace("'", "''") + "'"


def normalized_value(record: dict[str, Any], column: str, defaults: dict[str, Any]) -> Any:
    value = record.get(column, defaults.get(column))
    if column.endswith("_json") and value is not None and isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise ValueError(f"{column} must contain valid JSON") from error
    if column in {"doi", "original_paper_doi"} and value:
        value = normalize_doi(str(value))
    if column == "issns_json" and isinstance(value, list):
        value = sorted({normalize_issn(str(item)) for item in value if item})
    elif column.startswith("issn") and value:
        value = normalize_issn(str(value))
    return value


def normalize_doi(value: str) -> str:
    value = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", value.strip(), flags=re.I)
    value = re.sub(r"^doi:\s*", "", value, flags=re.I)
    return value.lower()


def normalize_issn(value: str) -> str:
    compact = re.sub(r"[^0-9X]", "", value.strip().upper())
    return compact[:4] + "-" + compact[4:] if len(compact) == 8 else compact


def iter_records(path: Path) -> Iterator[tuple[int, dict[str, Any]]]:
    if path.suffix == ".jsonl":
        with path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"{path.name}:{line_number}: invalid JSON") from error
                if not isinstance(record, dict):
                    raise ValueError(f"{path.name}:{line_number}: expected a JSON object")
                yield line_number, record
        return
    with path.open("r", encoding="utf-8", newline="") as stream:
        for line_number, record in enumerate(csv.DictReader(stream), 2):
            yield line_number, dict(record)


def load_source_manifest(input_dir: Path) -> dict[str, dict[str, Any]]:
    path = input_dir / SOURCE_MANIFEST
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"missing required {SOURCE_MANIFEST}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"{SOURCE_MANIFEST} is not valid JSON") from error
    entries = document.get("files") if isinstance(document, dict) else None
    if not isinstance(entries, list):
        raise ValueError(f"{SOURCE_MANIFEST}: 'files' must be an array")
    by_name: dict[str, dict[str, Any]] = {}
    required = {
        "filename", "family", "source_name", "source_url", "license_name",
        "license_url", "fetched_at", "sha256",
    }
    for entry in entries:
        if not isinstance(entry, dict) or not required.issubset(entry):
            raise ValueError(f"{SOURCE_MANIFEST}: every file needs {sorted(required)}")
        name = str(entry["filename"])
        if name in by_name:
            raise ValueError(f"{SOURCE_MANIFEST}: duplicate filename {name}")
        if not SHA256_RE.fullmatch(str(entry["sha256"])):
            raise ValueError(f"{SOURCE_MANIFEST}: invalid SHA-256 for {name}")
        by_name[name] = entry
    expected = set(TABLES)
    if set(by_name) != expected:
        missing = sorted(expected - set(by_name))
        extra = sorted(set(by_name) - expected)
        raise ValueError(f"{SOURCE_MANIFEST}: expected exact file set; missing={missing}, extra={extra}")
    return by_name


def validate_sources(input_dir: Path, sources: dict[str, dict[str, Any]]) -> None:
    for filename, table_spec in TABLES.items():
        path = input_dir / filename
        if not path.is_file():
            raise ValueError(f"missing required source file: {filename}")
        expected_family = table_spec[4]
        if sources[filename]["family"] != expected_family:
            raise ValueError(f"{filename}: family must be {expected_family}")
        actual = sha256_file(path)
        if actual != sources[filename]["sha256"]:
            raise ValueError(f"{filename}: checksum mismatch; expected {sources[filename]['sha256']}, got {actual}")


def family_checksum(filenames: tuple[str, ...], sources: dict[str, dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for filename in filenames:
        digest.update(filename.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(sources[filename]["sha256"]).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def write_manifest_rows(
    stream: Any,
    sources: dict[str, dict[str, Any]],
    snapshot_id: str,
    snapshot_at: str,
    row_counts: dict[str, int],
) -> None:
    columns = (
        "family", "snapshot_id", "schema_version", "source_name", "source_url",
        "license_name", "license_url", "fetched_at", "source_checksum_sha256",
        "row_count", "metadata_json", "imported_at",
    )
    for family, filenames in FAMILY_FILES.items():
        entries = [sources[name] for name in filenames]
        first = entries[0]
        for key in ("source_name", "source_url", "license_name", "license_url", "fetched_at"):
            if any(entry[key] != first[key] for entry in entries):
                raise ValueError(f"{family}: inconsistent {key} metadata across family files")
        metadata = {"files": [{"filename": name, "sha256": sources[name]["sha256"]} for name in filenames]}
        values = (
            family, snapshot_id, SCHEMA_VERSION, first["source_name"], first["source_url"],
            first["license_name"], first["license_url"], first["fetched_at"],
            family_checksum(filenames, sources), row_counts[family], metadata, snapshot_at,
        )
        stream.write(
            f"INSERT INTO authority_manifest ({', '.join(columns)}) VALUES "
            f"({', '.join(sql_value(value) for value in values)});\n"
        )


def write_data_rows(
    stream: Any,
    input_dir: Path,
    row_counts: dict[str, int],
) -> None:
    publisher_ids: set[str] = set()
    for filename, (table, key, columns, defaults, family) in TABLES.items():
        previous_key: str | None = None
        for line_number, record in iter_records(input_dir / filename):
            if key not in record or not str(record[key]).strip():
                raise ValueError(f"{filename}:{line_number}: missing primary key {key}")
            current_key = str(record[key])
            if previous_key is not None and current_key <= previous_key:
                raise ValueError(
                    f"{filename}:{line_number}: records must be uniquely sorted by {key}"
                )
            previous_key = current_key
            values = [normalized_value(record, column, defaults) for column in columns]
            if filename == "openalex_publishers.jsonl":
                publisher_ids.add(current_key)
            if filename == "openalex_sources.jsonl":
                values = [
                    value if column != "publisher_id" or value in publisher_ids else None
                    for column, value in zip(columns, values)
                ]
            if any(column in {"display_name", "title", "notice_type"} and value in (None, "")
                   for column, value in zip(columns, values)):
                raise ValueError(f"{filename}:{line_number}: missing required display field")
            stream.write(
                f"INSERT INTO {table} ({', '.join(columns)}, source_family) VALUES "
                f"({', '.join(sql_value(value) for value in values)}, {sql_value(family)});\n"
            )
            if filename == "openalex_sources.jsonl":
                issns = normalized_value(record, "issns_json", defaults)
                if not isinstance(issns, list):
                    raise ValueError(f"{filename}:{line_number}: issns_json must be an array")
                for issn in sorted({normalize_issn(str(item)) for item in issns if item}):
                    stream.write(
                        "INSERT INTO oa_source_issns (source_id, issn) VALUES "
                        f"({sql_value(current_key)}, {sql_value(issn)});\n"
                    )
            row_counts[family] += 1


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


def build(input_dir: Path, output_dir: Path, snapshot_id: str, snapshot_at: str) -> None:
    sources = load_source_manifest(input_dir)
    validate_sources(input_dir, sources)
    output_dir.mkdir(parents=True, exist_ok=True)
    row_counts = {family: 0 for family in FAMILY_FILES}
    descriptor, temporary = tempfile.mkstemp(prefix=".import.sql.", dir=output_dir)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write("PRAGMA foreign_keys = ON;\n")
            for table in DELETE_ORDER:
                stream.write(f"DELETE FROM {table};\n")
            # Manifest rows must exist before rows that reference their family.
            data_descriptor, data_temporary = tempfile.mkstemp(prefix=".authority-data.", dir=output_dir)
            try:
                with os.fdopen(data_descriptor, "w", encoding="utf-8", newline="\n") as data_stream:
                    write_data_rows(data_stream, input_dir, row_counts)
                write_manifest_rows(stream, sources, snapshot_id, snapshot_at, row_counts)
                with open(data_temporary, "r", encoding="utf-8") as data_stream:
                    for chunk in iter(lambda: data_stream.read(1024 * 1024), ""):
                        stream.write(chunk)
            finally:
                try:
                    os.unlink(data_temporary)
                except FileNotFoundError:
                    pass
            stream.flush()
            os.fsync(stream.fileno())
        import_path = output_dir / "import.sql"
        os.replace(temporary, import_path)
        checksum = sha256_file(import_path)
        atomic_json(
            output_dir / "manifest.json",
            {
                "schema_version": SCHEMA_VERSION,
                "snapshot_id": snapshot_id,
                "snapshot_at": snapshot_at,
                "import_sha256": checksum,
                "row_counts": row_counts,
                "source_manifest_sha256": sha256_file(input_dir / SOURCE_MANIFEST),
            },
        )
        atomic_json(
            output_dir / "licenses.json",
            {
                "snapshot_id": snapshot_id,
                "generated_at": snapshot_at,
                "families": [
                    {
                        "family": family,
                        "source_name": sources[filenames[0]]["source_name"],
                        "source_url": sources[filenames[0]]["source_url"],
                        "license_name": sources[filenames[0]]["license_name"],
                        "license_url": sources[filenames[0]]["license_url"],
                        "fetched_at": sources[filenames[0]]["fetched_at"],
                        "files": list(filenames),
                        **(
                            {
                                "attribution": (
                                    "Courtesy of the U.S. National Library of Medicine"
                                ),
                                "notes": (
                                    "This snapshot is dated and does not reflect the most "
                                    "current NLM catalog data."
                                ),
                            }
                            if family == "nlm"
                            else {}
                        ),
                    }
                    for family, filenames in FAMILY_FILES.items()
                ],
            },
        )
        checksum_path = output_dir / "import.sql.sha256"
        descriptor, temporary_checksum = tempfile.mkstemp(prefix=".import.sql.sha256.", dir=output_dir)
        with os.fdopen(descriptor, "w", encoding="ascii", newline="\n") as checksum_stream:
            checksum_stream.write(f"{checksum}  import.sql\n")
            checksum_stream.flush()
            os.fsync(checksum_stream.fileno())
        os.replace(temporary_checksum, checksum_path)
        plain_checksum_path = output_dir / "checksum.txt"
        descriptor, temporary_plain_checksum = tempfile.mkstemp(
            prefix=".checksum.txt.", dir=output_dir
        )
        with os.fdopen(
            descriptor, "w", encoding="ascii", newline="\n"
        ) as checksum_stream:
            checksum_stream.write(f"{checksum}\n")
            checksum_stream.flush()
            os.fsync(checksum_stream.fileno())
        os.replace(temporary_plain_checksum, plain_checksum_path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument(
        "--snapshot-at",
        required=True,
        help="Explicit RFC 3339 timestamp; required to keep output deterministic.",
    )
    args = parser.parse_args()
    build(args.input_dir, args.output_dir, args.snapshot_id, args.snapshot_at)


if __name__ == "__main__":
    main()
