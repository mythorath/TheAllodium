// @customcommander/ris ships no TypeScript declarations (plain CJS). This
// covers only the `read` surface used by tests/citations.test.ts to
// structurally validate generated RIS text against a real third-party
// parser. See docs/phase-2c-decision-record.md.
declare module "@customcommander/ris" {
  export function read(input: string): Array<Record<string, string[]>>;
}
