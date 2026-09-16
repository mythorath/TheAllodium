import { isAbsolute, relative, resolve } from "node:path";
import { RESERVED_COLLECTION_SLUGS } from "./slugs";

const ALLOWED_MODULE_SPECIFIERS = [
  "hono/jsx",
  "hono/jsx/jsx-runtime",
  "@allodium/collection",
];

const BANNED_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /\bc\.env\b/, message: "must not read c.env" },
  { re: /\bprocess\.env\b/, message: "must not read process.env" },
  { re: /\beval\s*\(/, message: "must not call eval" },
  { re: /\bnew\s+Function\s*\(/, message: "must not construct Function" },
  { re: /\bimport\s*\(/, message: "must not use dynamic import()" },
  { re: /\bfetch\s*\(/, message: "must not call fetch" },
  { re: /\bWebSocket\b/, message: "must not use WebSocket" },
  { re: /\bfrom\s+['"]hono['"]/, message: "must not import the full hono package" },
  { re: /\bfrom\s+['"]node:/, message: "must not import node: modules" },
  { re: /\bfrom\s+['"]fs['"]/, message: "must not import fs" },
  { re: /\bGPU_SHARED_SECRET\b/, message: "must not mention GPU_SHARED_SECRET" },
];

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s+|export\s+[\s\S]*?\s+from\s+)['"]([^'"]+)['"]/g;

const ABSOLUTE_PATH_RE =
  /(?:href|action|canonicalPath)\s*=\s*['"`](\/[^'"`\s]+)['"`]|location:\s*['"`](\/[^'"`\s]+)['"`]/g;

export type StaticAnalysisFinding = {
  file: string;
  message: string;
};

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function analyzeCollectionSource(
  files: Array<{ path: string; source: string }>,
  collectionRoot: string,
  slug?: string,
): StaticAnalysisFinding[] {
  const findings: StaticAnalysisFinding[] = [];
  const root = resolve(collectionRoot);
  const reserved = new Set<string>(RESERVED_COLLECTION_SLUGS);
  for (const file of files) {
    const rel = relative(root, file.path) || file.path;
    for (const banned of BANNED_PATTERNS) {
      if (banned.re.test(file.source)) {
        findings.push({ file: rel, message: banned.message });
      }
    }
    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_RE.exec(file.source)) !== null) {
      const spec = match[1];
      if (ALLOWED_MODULE_SPECIFIERS.includes(spec)) continue;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const resolved = resolve(file.path, "..", spec);
        if (!isInside(root, resolved)) {
          findings.push({
            file: rel,
            message: `import escapes the collection directory: ${spec}`,
          });
        }
        continue;
      }
      findings.push({
        file: rel,
        message: `import is not on the allowlist: ${spec}`,
      });
    }
    if (slug) {
      ABSOLUTE_PATH_RE.lastIndex = 0;
      let pathMatch: RegExpExecArray | null;
      while ((pathMatch = ABSOLUTE_PATH_RE.exec(file.source)) !== null) {
        const abs = pathMatch[1] ?? pathMatch[2];
        if (!abs) continue;
        if (abs.startsWith("http://") || abs.startsWith("https://")) continue;
        if (abs === `/${slug}` || abs.startsWith(`/${slug}/`)) continue;
        const firstSegment: string = abs.slice(1).split("/")[0] ?? "";
        if (reserved.has(firstSegment) || firstSegment !== slug) {
          findings.push({
            file: rel,
            message: `absolute path ${abs} is not under /${slug}/`,
          });
        }
      }
    }
  }
  return findings;
}

export const COLLECTION_SOURCE_BYTE_CEILING = 512_000;
