// @retorquere/bibtex-parser's published package.json points "types" at a
// dist/types path that doesn't actually exist in the published package (a
// packaging gap on their end, not something to fix upstream from here).
// This covers only the surface used by tests/citations.test.ts to
// structurally validate generated BibTeX against a real third-party
// parser. See docs/phase-2c-decision-record.md.
declare module "@retorquere/bibtex-parser" {
  export interface BibtexParseError {
    error: string;
    input: string;
  }

  export interface BibtexName {
    firstName?: string;
    lastName: string;
  }

  export interface BibtexEntryFields {
    title?: string;
    author?: BibtexName[];
    year?: string;
    journal?: string;
    organization?: string[];
    doi?: string;
    url?: string;
    [field: string]: unknown;
  }

  export interface BibtexEntry {
    type: string;
    key: string;
    fields: BibtexEntryFields;
    mode: Record<string, string>;
    input: string;
  }

  export interface BibtexParseResult {
    errors: BibtexParseError[];
    entries: BibtexEntry[];
    comments: unknown[];
    strings: Record<string, string>;
    preamble: string[];
    jabref: unknown;
  }

  export function parse(input: string, options?: Record<string, unknown>): BibtexParseResult;
  export function parseAsync(
    input: string,
    options?: Record<string, unknown>,
  ): Promise<BibtexParseResult>;
}
