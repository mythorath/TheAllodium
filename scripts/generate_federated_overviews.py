#!/usr/bin/env python3
"""Generate cached federated /works overviews via the LAN 5090 Ollama.

Reads doi-queue.jsonl (resolved HTTP 200 only), fetches an abstract
ephemerally from Crossref then PubMed, and upserts a 2–4 sentence paraphrase
into AUTHORITY.federated_work_overviews.

The abstract is never written to D1, logs, or stdout. Thin metadata
(title + authors + container) is used when no abstract exists; the prompt
must not invent findings.

Defaults match ACT's generate_overviews.py: 10.10.10.2:11435, qwen3.6:35b.

Usage:
    python3 scripts/generate_federated_overviews.py --doi-queue /mnt/smesh/allodium-verify/doi-queue.jsonl --dry-run --limit 3
    python3 scripts/generate_federated_overviews.py --doi-queue ... --env staging
    python3 scripts/generate_federated_overviews.py --doi-queue ... --env production --yes
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
from typing import Any, Callable, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OLLAMA_URL = os.environ.get("OLLAMA_LEGIT_URL", "http://10.10.10.2:11435")
DEFAULT_MODEL = os.environ.get("OLLAMA_LEGIT_MODEL", "qwen3.6:35b")
DEFAULT_MAILTO = os.environ.get("FEDERATION_CONTACT_EMAIL", "index@theallodium.org")
MAX_OVERVIEW_CHARS = 800
ABSTRACT_EXCERPT_CHARS = 4000
MIN_ABSTRACT_CHARS = 40
USER_AGENT = "TheAllodium-federated-overviews/0.1 (https://theallodium.org; mailto:{mailto})"

SYSTEM_PROMPT = """You write short, neutral overviews for a public scholarly
index (The Allodium Open Index). Readers use these to decide whether to open
the original paper — they are NOT clinical advice and not a substitute for
the source.

Rules:
- Write 2–4 sentences in your own words.
- Stay descriptive and neutral. No recommendations, no dosing/protocol
  instructions, no crisis counseling, no claims of efficacy beyond what
  the source itself states.
- Do not quote more than a short phrase from the source.
- Do not invent authors, findings, sample sizes, or outcomes not present
  in the provided text.
- If only title/authors/container are provided (no abstract), say what the
  record appears to be from that metadata and that limited detail is
  available. Do not invent findings.

Respond with ONLY JSON:
{"overview":"2-4 sentence paraphrase"}
"""

JATS_TAG = re.compile(r"<[^>]+>")
WHITESPACE = re.compile(r"\s+")


def normalize_doi(value: str) -> str:
    text = (value or "").strip()
    try:
        text = urllib.parse.unquote(text)
    except Exception:
        pass
    text = re.sub(r"^doi:\s*", "", text, flags=re.I)
    text = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", text, flags=re.I)
    return text.strip().rstrip(")]}>.,;:").lower()


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def strip_markup(text: str) -> str:
    return WHITESPACE.sub(" ", JATS_TAG.sub(" ", text or "")).strip()


def parse_doi_queue(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if not isinstance(record, dict):
                continue
            if int(record.get("http_status") or 0) != 200:
                continue
            doi = normalize_doi(str(record.get("doi") or ""))
            if not doi or doi in seen:
                continue
            seen.add(doi)
            rows.append({"doi": doi, "title": record.get("title")})
    return rows


def upsert_sql(
    doi: str,
    overview: str,
    model: str,
    generated_at: str,
    source_note: str,
) -> str:
    return (
        "INSERT OR REPLACE INTO federated_work_overviews "
        "(doi, overview, model, generated_at, source_note) VALUES ("
        f"{sql_string(doi)}, {sql_string(overview)}, {sql_string(model)}, "
        f"{sql_string(generated_at)}, {sql_string(source_note)});"
    )


def _parse_model_json(text: str) -> dict[str, Any] | None:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                return None
    return None


def cap_overview(overview: str) -> str:
    overview = WHITESPACE.sub(" ", overview).strip()
    if len(overview) > MAX_OVERVIEW_CHARS:
        overview = overview[: MAX_OVERVIEW_CHARS - 1].rstrip() + "…"
    return overview


def build_user_prompt(
    *,
    title: str,
    authors: str,
    container: str,
    abstract: str | None,
) -> tuple[str, str]:
    """Return (source_note, prompt). Abstract stays in the prompt only."""
    lines = [
        f"title: {title or '(unknown title)'}",
        f"authors: {authors or '(unknown)'}",
        f"container: {container or '(unknown)'}",
    ]
    if abstract and len(abstract) >= MIN_ABSTRACT_CHARS:
        lines.append("abstract:")
        lines.append(abstract[:ABSTRACT_EXCERPT_CHARS])
        return "crossref-or-pubmed-abstract", "\n".join(lines)
    lines.append(
        "No abstract was available. Summarize only from the metadata above. "
        "Do not invent findings."
    )
    return "metadata-only", "\n".join(lines)


def _http_bytes(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> bytes:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _http_json(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> Any:
    raw = _http_bytes(url, data=data, headers=headers, timeout=timeout)
    return json.loads(raw.decode("utf-8"))


def _crossref_work(doi: str, mailto: str) -> dict[str, Any] | None:
    params = urllib.parse.urlencode({"mailto": mailto})
    url = f"https://api.crossref.org/works/{urllib.parse.quote(doi, safe='')}?{params}"
    headers = {"User-Agent": USER_AGENT.format(mailto=mailto)}
    try:
        body = _http_json(url, headers=headers, timeout=20)
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None
    message = body.get("message") if isinstance(body, dict) else None
    return message if isinstance(message, dict) else None


def _first_text(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list):
        for item in value:
            text = _first_text(item)
            if text:
                return text
    return ""


def _authors_line(message: dict[str, Any]) -> str:
    authors = message.get("author")
    if not isinstance(authors, list):
        return ""
    names: list[str] = []
    for entry in authors[:12]:
        if not isinstance(entry, dict):
            continue
        given = str(entry.get("given") or "").strip()
        family = str(entry.get("family") or "").strip()
        name = " ".join(part for part in (given, family) if part)
        if name:
            names.append(name)
    return "; ".join(names)


def _pubmed_abstract(doi: str, mailto: str) -> str | None:
    params = urllib.parse.urlencode(
        {
            "db": "pubmed",
            "term": f"{doi}[doi]",
            "retmode": "json",
            "tool": "theallodium",
            "email": mailto,
        }
    )
    headers = {"User-Agent": USER_AGENT.format(mailto=mailto)}
    try:
        search = _http_json(
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?{params}",
            headers=headers,
            timeout=20,
        )
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None
    idlist = (
        search.get("esearchresult", {}).get("idlist")
        if isinstance(search, dict)
        else None
    )
    if not isinstance(idlist, list) or not idlist:
        return None
    pmid = str(idlist[0])
    fetch_params = urllib.parse.urlencode(
        {
            "db": "pubmed",
            "id": pmid,
            "retmode": "xml",
            "rettype": "abstract",
            "tool": "theallodium",
            "email": mailto,
        }
    )
    try:
        xml = _http_bytes(
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?{fetch_params}",
            headers=headers,
            timeout=20,
        ).decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None
    chunks = re.findall(r"<AbstractText[^>]*>(.*?)</AbstractText>", xml, flags=re.I | re.S)
    abstract = strip_markup(" ".join(chunks))
    return abstract or None


def fetch_work_metadata(
    doi: str,
    *,
    mailto: str,
    queue_title: str | None = None,
) -> tuple[str, str, str, str | None, str]:
    """Return title, authors, container, ephemeral abstract, source_note.

    The abstract is only returned to the caller; it must not be logged or stored.
    """
    message = _crossref_work(doi, mailto)
    title = ""
    authors = ""
    container = ""
    abstract: str | None = None
    if message:
        title = _first_text(message.get("title"))
        authors = _authors_line(message)
        container = _first_text(message.get("container-title"))
        raw_abstract = message.get("abstract")
        if isinstance(raw_abstract, str):
            cleaned = strip_markup(raw_abstract)
            if len(cleaned) >= MIN_ABSTRACT_CHARS:
                abstract = cleaned
    if not abstract:
        pubmed = _pubmed_abstract(doi, mailto)
        if pubmed and len(pubmed) >= MIN_ABSTRACT_CHARS:
            abstract = pubmed
    if not title:
        title = (queue_title or "").strip()
    note = "crossref-or-pubmed-abstract" if abstract else "metadata-only"
    return title, authors, container, abstract, note


def generate_overview(
    *,
    title: str,
    authors: str,
    container: str,
    abstract: str | None,
    ollama_url: str,
    model: str,
    timeout: int = 300,
    http_json: Callable[..., Any] = _http_json,
) -> str:
    _note, user = build_user_prompt(
        title=title, authors=authors, container=container, abstract=abstract
    )
    payload = json.dumps(
        {
            "model": model,
            "stream": False,
            "format": "json",
            "think": False,
            "keep_alive": "15m",
            "options": {"temperature": 0.2, "num_predict": 420},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
        }
    ).encode("utf-8")
    chat_url = ollama_url.rstrip("/") + "/api/chat"
    body = http_json(
        chat_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        timeout=timeout,
    )
    message = body.get("message", {}) if isinstance(body, dict) else {}
    content = (message or {}).get("content") or ""
    if not str(content).strip() and (message or {}).get("thinking"):
        content = str(message.get("thinking") or "")
    parsed = _parse_model_json(str(content)) or {}
    overview = cap_overview(str(parsed.get("overview") or ""))
    if len(overview) < 20:
        raise RuntimeError("empty_or_short_overview")
    return overview


def load_existing_dois(
    *,
    env_name: str,
    local: bool,
    existing_file: Path | None,
) -> set[str]:
    if existing_file is not None:
        text = existing_file.read_text(encoding="utf-8")
        return {normalize_doi(line) for line in text.splitlines() if line.strip()}
    args = ["npx", "wrangler", "d1", "execute", "AUTHORITY"]
    if local or env_name == "local":
        args += ["--local"]
    else:
        args += ["--env", env_name, "--remote"]
    args += [
        "--json",
        "--command",
        "SELECT doi FROM federated_work_overviews",
        "--yes",
    ]
    result = subprocess.run(
        args,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    parsed = json.loads(result.stdout)
    rows = parsed[0].get("results") if parsed else []
    return {
        normalize_doi(str(row.get("doi") or ""))
        for row in (rows or [])
        if isinstance(row, dict)
    }


def apply_sql(statements: Iterable[str], *, env_name: str, local: bool) -> None:
    sql = "\n".join(statements) + "\n"
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        suffix=".sql",
        prefix="federated-overviews-",
        delete=False,
    ) as handle:
        handle.write(sql)
        handle.flush()
        path = handle.name
    try:
        args = ["npx", "wrangler", "d1", "execute", "AUTHORITY"]
        if local or env_name == "local":
            args += ["--local"]
        else:
            args += ["--env", env_name, "--remote"]
        args += ["--file", path, "--yes"]
        subprocess.run(args, cwd=ROOT, check=True)
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--doi-queue", required=True, type=Path)
    parser.add_argument("--env", default="local", choices=("local", "staging", "production"))
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--sleep", type=float, default=0.05)
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--mailto", default=DEFAULT_MAILTO)
    parser.add_argument("--existing-dois-file", type=Path, default=None)
    parser.add_argument("--sql-out", type=Path, default=None)
    args = parser.parse_args(argv)

    if args.env == "production" and not args.yes and not args.dry_run:
        print("Refusing production AUTHORITY writes without --yes", file=sys.stderr)
        return 2

    queue = parse_doi_queue(args.doi_queue)
    existing: set[str] = set()
    if not args.refresh:
        existing = {
            doi for doi in load_existing_dois(
                env_name=args.env,
                local=args.env == "local",
                existing_file=args.existing_dois_file,
            )
            if doi
        }
    candidates = [row for row in queue if row["doi"] not in existing]
    if args.limit is not None:
        candidates = candidates[: args.limit]

    print(
        f"queue_resolved={len(queue)} existing={len(existing)} "
        f"candidates={len(candidates)} model={args.model}",
        flush=True,
    )

    statements: list[str] = []
    generated = 0
    skipped = 0
    errors = 0
    for row in candidates:
        doi = row["doi"]
        try:
            title, authors, container, abstract, source_note = fetch_work_metadata(
                doi, mailto=args.mailto, queue_title=row.get("title")
            )
            overview = generate_overview(
                title=title,
                authors=authors,
                container=container,
                abstract=abstract,
                ollama_url=args.ollama_url,
                model=args.model,
            )
            abstract = None  # drop ephemeral text as soon as generation returns
            generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            statements.append(
                upsert_sql(doi, overview, args.model, generated_at, source_note)
            )
            generated += 1
            print(f"{doi}\tok\tsource={source_note}", flush=True)
        except Exception as exc:  # noqa: BLE001 — keep going; never print abstract
            errors += 1
            print(f"{doi}\terror\t{type(exc).__name__}", flush=True)
        if args.sleep:
            time.sleep(args.sleep)

    skipped = len(queue) - len(candidates)
    print(f"generated={generated} skipped_existing={skipped} errors={errors}", flush=True)

    if args.sql_out is not None:
        args.sql_out.write_text("\n".join(statements) + ("\n" if statements else ""), encoding="utf-8")
    if args.dry_run or not statements:
        return 0 if errors == 0 else 1
    apply_sql(statements, env_name=args.env, local=args.env == "local")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
