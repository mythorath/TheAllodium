import type { PublicEntry } from "./contract";

/**
 * Phase 2C: pure, DB-free citation formatting for the entry page's BibTeX /
 * RIS / APA export. Every function here takes only a `PublicEntry` — no D1,
 * no I/O — so it's testable in isolation and safe to call from view code.
 *
 * Known simplifications (documented rather than silently assumed):
 * - Author names are stored as opaque display strings (`author`) or
 *   `{ name }` records (`authors_json`), never structured given/family
 *   fields. `splitName()` guesses family name = last whitespace token,
 *   which is wrong for multi-word surnames, particles ("van der Berg"),
 *   and name suffixes — a documented best-effort, not scholarly-grade
 *   parsing.
 * - The contract has no journal/volume/issue/page fields, so `source_org`
 *   stands in for BibTeX's `journal`/`organization` field. This is the best
 *   publicly available approximation, not a claim of full bibliographic
 *   precision.
 */

/**
 * Structured authors (from `authors_json`) are a list of names we can
 * safely run `splitName()`/initialing over. A plain `author` string is an
 * opaque display string with unknown internal structure (could already be
 * "Given Family", multiple names joined some other way, an org name, etc.)
 * — kept as one atomic unit and never re-split, per each format's own
 * handling below.
 */
type AuthorSource =
  | { kind: "structured"; names: string[] }
  | { kind: "plain"; text: string }
  | { kind: "none" };

function resolveAuthors(entry: PublicEntry): AuthorSource {
  if (entry.authors && entry.authors.length > 0) {
    return { kind: "structured", names: entry.authors.map((a) => a.name) };
  }
  if (entry.author) {
    return { kind: "plain", text: entry.author };
  }
  return { kind: "none" };
}

/** First 4-digit run in `published_date` (handles both bare-year and
 * full-ISO-date storage seen in the corpus), else `null` for "no date". */
function citationYear(entry: PublicEntry): string | null {
  const match = entry.published_date?.match(/\d{4}/);
  return match ? match[0] : null;
}

/** Best-effort family/given split: last whitespace-separated token is the
 * family name, everything before it is given names. Single-token names
 * (mononyms, or already-abbreviated strings) pass through unsplit. */
function splitName(fullName: string): { family: string; given: string[] } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) {
    return { family: fullName.trim(), given: [] };
  }
  return { family: parts[parts.length - 1], given: parts.slice(0, -1) };
}

function initials(given: string[]): string {
  return given.map((g) => `${g.charAt(0).toUpperCase()}.`).join(" ");
}

/** DOI rendered as a doi.org link wherever a citation needs "the" URL for
 * this entry, falling back to the canonical source URL otherwise. Exported
 * so view code (the APA block's real `<a href>`) derives the exact same
 * URL rather than re-deriving it with a second copy of this formula. */
export function citationUrl(entry: PublicEntry): string {
  return entry.doi ? `https://doi.org/${entry.doi}` : entry.canonical_url;
}

function escapeBibtex(value: string): string {
  return value.replace(/[\\&%$#_{}~^]/g, (ch) => {
    if (ch === "\\") return "\\textbackslash{}";
    if (ch === "~") return "\\textasciitilde{}";
    if (ch === "^") return "\\textasciicircum{}";
    return `\\${ch}`;
  });
}

function bibtexKey(entry: PublicEntry): string {
  // The entry's own id is already a stable, URL-safe, globally unique
  // identifier — reusing it avoids fragile name/year-based key generation
  // (collisions, empty-author entries, non-Latin names) entirely.
  return `allodium:${entry.id}`;
}

export function buildBibtex(entry: PublicEntry): string {
  const authors = resolveAuthors(entry);
  const year = citationYear(entry);
  const isPaper = entry.resource_type === "paper";
  const type = isPaper ? "article" : "misc";
  const fields: Array<[string, string]> = [];

  fields.push(["title", `{${escapeBibtex(entry.title)}}`]);
  if (authors.kind === "structured") {
    fields.push(["author", `{${authors.names.map(escapeBibtex).join(" and ")}}`]);
  } else if (authors.kind === "plain") {
    fields.push(["author", `{${escapeBibtex(authors.text)}}`]);
  }
  if (year) fields.push(["year", `{${year}}`]);
  if (entry.source_org) {
    fields.push([
      isPaper ? "journal" : "organization",
      `{${escapeBibtex(entry.source_org)}}`,
    ]);
  }
  if (entry.doi) fields.push(["doi", `{${entry.doi}}`]);
  fields.push(["url", `{${citationUrl(entry)}}`]);

  const body = fields.map(([key, value]) => `  ${key} = ${value}`).join(",\n");
  return `@${type}{${bibtexKey(entry)},\n${body}\n}`;
}

export function buildRis(entry: PublicEntry): string {
  const authors = resolveAuthors(entry);
  const year = citationYear(entry);
  const isPaper = entry.resource_type === "paper";
  const lines: string[] = [];

  lines.push(`TY  - ${isPaper ? "JOUR" : "GEN"}`);
  lines.push(`TI  - ${entry.title}`);
  if (authors.kind === "structured") {
    for (const name of authors.names) {
      const { family, given } = splitName(name);
      lines.push(`AU  - ${given.length > 0 ? `${family}, ${given.join(" ")}` : family}`);
    }
  } else if (authors.kind === "plain") {
    lines.push(`AU  - ${authors.text}`);
  }
  if (year) lines.push(`PY  - ${year}`);
  if (entry.source_org) lines.push(`PB  - ${entry.source_org}`);
  if (entry.doi) lines.push(`DO  - ${entry.doi}`);
  lines.push(`UR  - ${citationUrl(entry)}`);
  lines.push(`ER  - `);

  return lines.join("\n");
}

function apaStructuredAuthorList(names: string[]): string {
  const formatted = names.map((name) => {
    const { family, given } = splitName(name);
    return given.length > 0 ? `${family}, ${initials(given)}` : family;
  });
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`;
}

function apaAuthorLead(authors: AuthorSource): string {
  if (authors.kind === "structured") return apaStructuredAuthorList(authors.names);
  if (authors.kind === "plain") return authors.text;
  return "";
}

export function buildApa(entry: PublicEntry): string {
  const authors = resolveAuthors(entry);
  const year = citationYear(entry) ?? "n.d.";
  const url = citationUrl(entry);
  const sourceOrg = entry.source_org ? ` ${entry.source_org}.` : "";
  const authorList = apaAuthorLead(authors);

  // APA's no-author convention: the title moves to the author position
  // rather than the citation opening with a bare "(Year)".
  const lead = authorList ? `${authorList} (${year}). ${entry.title}.` : `${entry.title}. (${year}).`;

  return `${lead}${sourceOrg} ${url}`;
}

export type EntryCitations = {
  bibtex: string;
  ris: string;
  apa: string;
};

export function buildCitations(entry: PublicEntry): EntryCitations {
  return {
    bibtex: buildBibtex(entry),
    ris: buildRis(entry),
    apa: buildApa(entry),
  };
}
