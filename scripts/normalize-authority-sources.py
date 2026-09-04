#!/usr/bin/env python3
"""Normalize local authority downloads into the snapshot builder contract."""

import argparse
import csv
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import tempfile
from typing import Any, Callable, Iterable, Iterator
import xml.etree.ElementTree as ElementTree
import zipfile


OPENALEX_ENTITIES = (
    "publishers", "sources", "institutions",
    "domains", "fields", "subfields", "topics",
)
OUTPUT_FILES = {
    "publishers": "openalex_publishers.jsonl",
    "sources": "openalex_sources.jsonl",
    "institutions": "openalex_institutions.jsonl",
    "domains": "openalex_domains.jsonl",
    "fields": "openalex_fields.jsonl",
    "subfields": "openalex_subfields.jsonl",
    "topics": "openalex_topics.jsonl",
    "ror": "ror_organizations.jsonl",
    "retraction_watch": "retraction_watch_notices.csv",
    "doaj": "doaj_journals.jsonl",
    "nlm": "nlm_journals.jsonl",
}
LICENSES = {
    "openalex": (
        "OpenAlex", "CC0 1.0",
        "https://creativecommons.org/publicdomain/zero/1.0/",
    ),
    "ror": (
        "Research Organization Registry", "CC0 1.0",
        "https://creativecommons.org/publicdomain/zero/1.0/",
    ),
    "retraction_watch": (
        "Retraction Watch via Crossref", "CC BY 4.0",
        "https://creativecommons.org/licenses/by/4.0/",
    ),
    "doaj": (
        "Directory of Open Access Journals", "CC0 1.0",
        "https://creativecommons.org/publicdomain/zero/1.0/",
    ),
    "nlm": (
        "NLM Catalog journal data", "NLM data terms",
        "https://www.nlm.nih.gov/databases/download/terms_and_conditions.html",
    ),
}
RETRACTION_COLUMNS = (
    "id", "doi", "original_paper_doi", "title", "journal", "publisher",
    "notice_type", "notice_date", "original_paper_date", "reason_json",
)


def first(record: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


def nested_id(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("id")
    return str(value) if value not in (None, "") else None


def string_list(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(";") if part.strip()]
    if isinstance(value, list):
        return sorted({str(item) for item in value if item not in (None, "")})
    return [str(value)]


def read_json_records(path: Path) -> Iterator[dict[str, Any]]:
    if path.suffix.lower() == ".parquet":
        try:
            parquet = importlib.import_module("pyarrow.parquet")
        except ModuleNotFoundError as error:
            raise RuntimeError(
                f"{path}: Parquet input requires pyarrow; install it with "
                "`python -m pip install pyarrow` in an isolated environment"
            ) from error
        parquet_file = parquet.ParquetFile(path)
        for batch in parquet_file.iter_batches(batch_size=10_000):
            for record in batch.to_pylist():
                yield dict(record)
        return
    if path.suffix.lower() == ".jsonl":
        with path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError(f"{path}:{line_number}: expected a JSON object")
                yield record
        return
    document = json.loads(path.read_text(encoding="utf-8"))
    records = document.get("results") if isinstance(document, dict) else document
    if not isinstance(records, list):
        raise ValueError(f"{path}: expected an array or an object with a results array")
    for record in records:
        if not isinstance(record, dict):
            raise ValueError(f"{path}: expected every record to be an object")
        yield record


def read_zip_member(path: Path, suffix: str) -> bytes:
    with zipfile.ZipFile(path) as archive:
        candidates = sorted(
            name for name in archive.namelist()
            if not name.endswith("/") and name.lower().endswith(suffix)
        )
        if len(candidates) != 1:
            raise ValueError(f"{path}: expected exactly one {suffix} member, found {candidates}")
        info = archive.getinfo(candidates[0])
        if info.file_size > 1024 * 1024 * 1024:
            raise ValueError(f"{path}: expanded member exceeds 1 GiB safety limit")
        return archive.read(info)


def openalex_common(record: dict[str, Any]) -> dict[str, Any]:
    identifier = nested_id(record.get("id"))
    display_name = first(record, "display_name", "name", default=identifier)
    return {
        "id": identifier,
        "display_name": display_name,
        "description": record.get("description"),
        "works_count": record.get("works_count"),
        "cited_by_count": record.get("cited_by_count"),
    }


def normalize_openalex(entity: str, record: dict[str, Any]) -> dict[str, Any]:
    common = openalex_common(record)
    if entity == "publishers":
        return {
            "id": common["id"],
            "display_name": common["display_name"],
            "alternate_titles_json": string_list(record.get("alternate_titles")),
            "country_codes_json": string_list(record.get("country_codes")),
            "hierarchy_level": record.get("hierarchy_level"),
            "parent_publisher_id": nested_id(record.get("parent_publisher")),
            "works_count": common["works_count"],
            "cited_by_count": common["cited_by_count"],
        }
    if entity == "sources":
        return {
            "id": common["id"],
            "display_name": common["display_name"],
            "issn_l": record.get("issn_l"),
            "issns_json": string_list(first(record, "issn", "issns", default=[])),
            "host_organization_id": nested_id(record.get("host_organization")),
            "publisher_id": nested_id(
                first(record, "publisher_id", "publisher", "host_organization")
            ),
            "source_type": first(record, "type", "source_type"),
            "is_oa": record.get("is_oa"),
            "is_in_doaj": record.get("is_in_doaj"),
            "works_count": common["works_count"],
            "cited_by_count": common["cited_by_count"],
            "homepage_url": record.get("homepage_url"),
        }
    if entity == "institutions":
        lineage = [
            nested_id(item) for item in record.get("lineage", [])
            if nested_id(item) != common["id"]
        ]
        return {
            "id": common["id"],
            "ror_id": nested_id(record.get("ror")),
            "display_name": common["display_name"],
            "country_code": record.get("country_code"),
            "institution_type": first(record, "type", "institution_type"),
            "parent_institution_id": first(
                record, "parent_institution_id", default=lineage[-1] if lineage else None
            ),
            "works_count": common["works_count"],
            "cited_by_count": common["cited_by_count"],
        }
    parent_key = {"fields": "domain", "subfields": "field", "topics": "subfield"}.get(entity)
    result = common
    if parent_key:
        result[f"{parent_key}_id"] = nested_id(
            first(record, parent_key, f"{parent_key}_id")
        )
    if entity == "topics":
        result["keywords_json"] = string_list(record.get("keywords"))
    return result


def normalize_ror(record: dict[str, Any]) -> dict[str, Any]:
    names = record.get("names") if isinstance(record.get("names"), list) else []
    display_names = [
        item.get("value") for item in names
        if isinstance(item, dict) and "ror_display" in item.get("types", [])
    ]
    aliases = [
        item.get("value") for item in names
        if isinstance(item, dict) and "alias" in item.get("types", [])
    ]
    labels = [
        {"label": item.get("value"), "iso639": item.get("lang")}
        for item in names
        if isinstance(item, dict) and "label" in item.get("types", [])
    ]
    locations = record.get("locations") if isinstance(record.get("locations"), list) else []
    details = locations[0].get("geonames_details", {}) if locations else {}
    links = record.get("links")
    if isinstance(links, list):
        website = next(
            (
                item.get("value") for item in links
                if isinstance(item, dict) and item.get("type") == "website"
            ),
            next((item for item in links if isinstance(item, str)), None),
        )
    else:
        website = None
    country = record.get("country") if isinstance(record.get("country"), dict) else {}
    return {
        "id": nested_id(record.get("id")),
        "display_name": first(
            record, "name", default=display_names[0] if display_names else None
        ),
        "organization_types_json": string_list(record.get("types")),
        "country_code": first(details, "country_code", default=country.get("country_code")),
        "status": record.get("status"),
        "established_year": first(record, "established", "established_year"),
        "website_url": website,
        "aliases_json": string_list(first(record, "aliases", default=aliases)),
        "labels_json": first(record, "labels", default=labels),
        "external_ids_json": record.get("external_ids", {}),
    }


def canonical_headers(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "".join(character.lower() for character in key if character.isalnum()): value
        for key, value in record.items()
    }


def normalize_retraction(record: dict[str, Any]) -> dict[str, Any]:
    fields = canonical_headers(record)
    reasons = string_list(first(fields, "reason", "reasons", default=[]))
    return {
        "id": first(fields, "recordid", "id"),
        "doi": first(fields, "retractiondoi", "noticedoi", "doi"),
        "original_paper_doi": first(fields, "originalpaperdoi", "originaldoi"),
        "title": first(fields, "title", "retractiontitle"),
        "journal": fields.get("journal"),
        "publisher": fields.get("publisher"),
        "notice_type": first(fields, "retractionnature", "noticetype", default="Retraction"),
        "notice_date": first(fields, "retractiondate", "noticedate"),
        "original_paper_date": first(fields, "originalpaperdate", "originaldate"),
        "reason_json": reasons,
    }


def normalize_doaj(record: dict[str, Any]) -> dict[str, Any]:
    fields = canonical_headers(record)
    issn = first(fields, "journalissnprintversion", "issn")
    eissn = first(
        fields, "journaleissnonlineversion", "journalissnonlineversion", "eissn"
    )
    identifier = first(fields, "id", "doajid", "urlindoaj", default=eissn or issn)
    return {
        "id": identifier,
        "title": first(fields, "journaltitle", "title"),
        "issn": issn,
        "eissn": eissn,
        "publisher": first(fields, "publisher", "publishername"),
        # The journal CSV's "Country of publisher" is a name, not an ISO code.
        "country_code": fields.get("countrycode"),
        "added_on": first(fields, "addedondate", "datejournaladdedtodoaj", "addedon"),
        "last_updated": first(
            fields,
            "lastupdateddate",
            "datejournalinformationlastupdated",
            "lastupdated",
        ),
        "seal": str(first(fields, "doajseal", "seal", default="")).lower() in {"yes", "true", "1"},
        "license_json": string_list(first(fields, "journallicense", "license", default=[])),
        "subjects_json": string_list(
            first(fields, "subject", "subjects", "keywords", default=[])
        ),
    }


def child_text(element: ElementTree.Element, names: Iterable[str]) -> str | None:
    wanted = {name.lower() for name in names}
    for child in element.iter():
        tag = child.tag.rsplit("}", 1)[-1].lower()
        if tag in wanted and child.text and child.text.strip():
            return child.text.strip()
    return None


def normalize_nlm_xml(path: Path) -> Iterator[dict[str, Any]]:
    seen: set[str] = set()
    for _, element in ElementTree.iterparse(path, events=("end",)):
        if element.tag.rsplit("}", 1)[-1].lower() not in {"nlmcatalogrecord", "serial"}:
            continue
        issns: dict[str, str] = {}
        for item in element.iter():
            if item.tag.rsplit("}", 1)[-1].lower() != "issn" or not item.text:
                continue
            issn_type = str(first(item.attrib, "IssnType", "ISSNType", default="")).lower()
            if issn_type:
                issns[issn_type] = item.text.strip()
        languages = [
            item.text.strip() for item in element.iter()
            if item.tag.rsplit("}", 1)[-1].lower() == "language"
            and item.text and item.text.strip()
        ]
        nlm_id = child_text(element, ("NlmUniqueID", "NLMID"))
        if not nlm_id or nlm_id in seen:
            element.clear()
            continue
        seen.add(nlm_id)
        yield {
            "nlm_id": nlm_id,
            "title": child_text(element, ("TitleMain", "Title")),
            "abbreviation": child_text(element, ("IsoAbbreviation", "Abbreviation")),
            "issn_print": first(issns, "print", default=child_text(element, ("ISSNPrint",))),
            "issn_electronic": first(
                issns, "electronic", default=child_text(element, ("ISSNElectronic",))
            ),
            "issn_linking": child_text(element, ("ISSNLinking", "ISSN-L")),
            "publisher": child_text(element, ("Publisher", "PublisherName")),
            "country": child_text(element, ("Country",)),
            "language_json": sorted(set(languages)),
            "medline_ta": child_text(element, ("MedlineTA",)),
        }
        element.clear()


def csv_records(path: Path) -> Iterator[dict[str, Any]]:
    if path.suffix.lower() == ".zip":
        stream = io.StringIO(read_zip_member(path, ".csv").decode("utf-8-sig"))
        yield from csv.DictReader(stream)
        return
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        yield from csv.DictReader(stream)


def ror_records(path: Path) -> Iterator[dict[str, Any]]:
    if path.suffix.lower() == ".zip":
        document = json.loads(read_zip_member(path, ".json"))
        if not isinstance(document, list):
            raise ValueError(f"{path}: ROR archive JSON must be an array")
        for record in document:
            yield dict(record)
        return
    yield from read_json_records(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write(path: Path, writer: Callable[[Any], None], newline: str | None = "\n") -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline=newline) as stream:
            writer(stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def write_jsonl(path: Path, records: Iterable[dict[str, Any]], key: str) -> None:
    normalized = sorted(records, key=lambda record: str(record.get(key) or ""))
    if any(not record.get(key) for record in normalized):
        raise ValueError(f"{path.name}: every record requires {key}")
    if len({str(record[key]) for record in normalized}) != len(normalized):
        raise ValueError(f"{path.name}: duplicate {key}")

    def writer(stream: Any) -> None:
        for record in normalized:
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            stream.write("\n")

    atomic_write(path, writer)


def write_retractions(path: Path, records: Iterable[dict[str, Any]]) -> None:
    normalized = sorted(records, key=lambda record: str(record.get("id") or ""))

    def writer(stream: Any) -> None:
        output = csv.DictWriter(stream, fieldnames=RETRACTION_COLUMNS, lineterminator="\n")
        output.writeheader()
        for record in normalized:
            if not record.get("id"):
                raise ValueError(f"{path.name}: every record requires id")
            row = dict(record)
            row["reason_json"] = json.dumps(row["reason_json"], separators=(",", ":"))
            output.writerow(row)

    atomic_write(path, writer, newline="")


def smoke_records() -> dict[str, list[dict[str, Any]]]:
    return {
        "publishers": [{"id": "P1", "display_name": "Publisher"}],
        "sources": [{"id": "S1", "display_name": "Journal", "issn": ["1234-567X"], "publisher_id": "P1"}],
        "institutions": [{"id": "I1", "display_name": "Institute", "ror": "01abcde12"}],
        "domains": [{"id": "D1", "display_name": "Health"}],
        "fields": [{"id": "FL1", "display_name": "Psychology", "domain": {"id": "D1"}}],
        "subfields": [{"id": "SF1", "display_name": "Clinical", "field": {"id": "FL1"}}],
        "topics": [{
            "id": "T1", "display_name": "Therapy", "subfield": {"id": "SF1"},
            "keywords": ["therapy", "clinical"],
        }],
        "ror": [{"id": "01abcde12", "name": "Institute", "types": ["Education"]}],
        "retraction_watch": [{
            "Record ID": "RW1", "Title": "Notice", "OriginalPaperDOI": "10.1/example",
            "RetractionNature": "Retraction", "Reason": "Error",
        }],
        "doaj": [{"id": "J1", "title": "Journal", "issn": "1234-567X", "subjects": ["Medicine"]}],
        "nlm": [{
            "nlm_id": "N1", "title": "Journal", "issn_print": "1234-567X",
            "language_json": ["eng"],
        }],
    }


def normalize(args: argparse.Namespace) -> None:
    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw = smoke_records() if args.smoke_fixture else {}
    generated: list[tuple[str, str, str]] = []
    for entity in OPENALEX_ENTITIES:
        source_path = getattr(args, f"openalex_{entity}")
        records = raw[entity] if args.smoke_fixture else read_json_records(source_path)
        filename = OUTPUT_FILES[entity]
        write_jsonl(
            args.output_dir / filename,
            (normalize_openalex(entity, record) for record in records),
            "id",
        )
        generated.append((filename, "openalex", args.openalex_source_url))

    ror_source = raw["ror"] if args.smoke_fixture else ror_records(args.ror)
    write_jsonl(
        args.output_dir / OUTPUT_FILES["ror"],
        (normalize_ror(record) for record in ror_source),
        "id",
    )
    generated.append((OUTPUT_FILES["ror"], "ror", args.ror_source_url))

    rw_source = raw["retraction_watch"] if args.smoke_fixture else csv_records(args.retraction_watch)
    write_retractions(
        args.output_dir / OUTPUT_FILES["retraction_watch"],
        (
            record
            for record in (normalize_retraction(raw_record) for raw_record in rw_source)
            if record.get("id")
        ),
    )
    generated.append(
        (OUTPUT_FILES["retraction_watch"], "retraction_watch", args.retraction_watch_source_url)
    )

    doaj_source = raw["doaj"] if args.smoke_fixture else csv_records(args.doaj)
    write_jsonl(
        args.output_dir / OUTPUT_FILES["doaj"],
        (normalize_doaj(record) for record in doaj_source),
        "id",
    )
    generated.append((OUTPUT_FILES["doaj"], "doaj", args.doaj_source_url))

    nlm_source = raw["nlm"] if args.smoke_fixture else normalize_nlm_xml(args.nlm)
    write_jsonl(args.output_dir / OUTPUT_FILES["nlm"], nlm_source, "nlm_id")
    generated.append((OUTPUT_FILES["nlm"], "nlm", args.nlm_source_url))

    files = []
    for filename, family, source_url in generated:
        source_name, license_name, license_url = LICENSES[family]
        files.append({
            "filename": filename,
            "family": family,
            "source_name": source_name,
            "source_url": source_url,
            "license_name": license_name,
            "license_url": license_url,
            "fetched_at": args.fetched_at,
            "sha256": sha256_file(args.output_dir / filename),
        })

    def manifest_writer(stream: Any) -> None:
        json.dump({"files": files}, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write("\n")

    atomic_write(args.output_dir / "authority-source-manifest.json", manifest_writer)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--output-dir", required=True, type=Path)
    result.add_argument("--fetched-at", required=True, help="RFC 3339 timestamp from the download manifest")
    result.add_argument("--smoke-fixture", action="store_true", help="Generate a tiny offline fixture")
    for entity in OPENALEX_ENTITIES:
        result.add_argument(f"--openalex-{entity}", type=Path)
    result.add_argument("--ror", type=Path, help="ROR JSON or release ZIP")
    result.add_argument("--retraction-watch", type=Path, help="Retraction Watch CSV")
    result.add_argument("--doaj", type=Path, help="DOAJ journal CSV or ZIP")
    result.add_argument("--nlm", type=Path, help="NLM Catalog XML")
    result.add_argument("--openalex-source-url", default="https://openalex.org/data-dump")
    result.add_argument("--ror-source-url", default="https://ror.org/data/")
    result.add_argument(
        "--retraction-watch-source-url",
        default="https://gitlab.com/crossref/retraction-watch-data",
    )
    result.add_argument("--doaj-source-url", default="https://doaj.org/csv")
    result.add_argument("--nlm-source-url", default="https://www.nlm.nih.gov/databases/download/")
    return result


def main() -> None:
    args = parser().parse_args()
    required = [getattr(args, f"openalex_{entity}") for entity in OPENALEX_ENTITIES]
    required.extend((args.ror, args.retraction_watch, args.doaj, args.nlm))
    if not args.smoke_fixture and any(path is None for path in required):
        parser().error(
            "normalization requires all seven --openalex-* inputs plus --ror, "
            "--retraction-watch, --doaj, and --nlm; or use --smoke-fixture"
        )
    normalize(args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        raise SystemExit(f"error: {error}") from error
