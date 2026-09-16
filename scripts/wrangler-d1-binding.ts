export type WranglerD1Env = "default" | "staging" | "production";

export type D1BindingSpec = {
  binding: string;
  databaseName: string;
  databaseId: string;
  migrationsDir: string;
  comment?: string;
};

export type JsoncArrayRange = {
  keyIndex: number;
  open: number;
  close: number;
};

function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

export function findJsoncArrayRanges(text: string, key: string): JsoncArrayRange[] {
  const needle = `"${key}"`;
  const ranges: JsoncArrayRange[] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const keyIndex = text.indexOf(needle, searchFrom);
    if (keyIndex === -1) break;
    const colon = text.indexOf(":", keyIndex + needle.length);
    if (colon === -1) break;
    let i = colon + 1;
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    if (text[i] !== "[") {
      searchFrom = keyIndex + needle.length;
      continue;
    }
    const open = i;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        i = skipString(text, i);
        continue;
      }
      if (ch === "/" && text[i + 1] === "/") {
        const newline = text.indexOf("\n", i);
        i = newline === -1 ? text.length : newline + 1;
        continue;
      }
      if (ch === "[" || ch === "{") depth += 1;
      if (ch === "]" || ch === "}") {
        depth -= 1;
        if (ch === "]" && depth === 0) {
          ranges.push({ keyIndex, open, close: i });
          break;
        }
      }
      i += 1;
    }
    searchFrom = (ranges[ranges.length - 1]?.close ?? keyIndex) + 1;
  }
  return ranges;
}

function formatBinding(spec: D1BindingSpec, indent: string): string {
  const comment = spec.comment ? `${indent}// ${spec.comment}\n` : "";
  return (
    `${comment}` +
    `${indent}{\n` +
    `${indent}  "binding": ${JSON.stringify(spec.binding)},\n` +
    `${indent}  "database_name": ${JSON.stringify(spec.databaseName)},\n` +
    `${indent}  "database_id": ${JSON.stringify(spec.databaseId)},\n` +
    `${indent}  "migrations_dir": ${JSON.stringify(spec.migrationsDir)}\n` +
    `${indent}}`
  );
}

function replaceExistingBinding(slice: string, spec: D1BindingSpec): string {
  const marker = `"binding": "${spec.binding}"`;
  const markerIndex = slice.indexOf(marker);
  if (markerIndex === -1) return slice;
  let start = markerIndex;
  while (start > 0 && slice[start] !== "{") start -= 1;
  let depth = 0;
  let end = start;
  while (end < slice.length) {
    const ch = slice[end];
    if (ch === '"' || ch === "'") {
      end = skipString(slice, end);
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
    end += 1;
  }
  const indentMatch = slice.slice(0, start).match(/[ \t]*$/);
  const indent = indentMatch ? indentMatch[0] : "    ";
  return slice.slice(0, start) + formatBinding(spec, indent) + slice.slice(end);
}

function envRangeIndex(env: WranglerD1Env): number {
  switch (env) {
    case "default":
      return 0;
    case "staging":
      return 1;
    case "production":
      return 2;
    default: {
      const exhaustive: never = env;
      return exhaustive;
    }
  }
}

export function upsertD1Binding(
  jsonc: string,
  env: WranglerD1Env,
  spec: D1BindingSpec,
): string {
  const ranges = findJsoncArrayRanges(jsonc, "d1_databases");
  if (ranges.length < 3) {
    throw new Error(
      `wrangler.jsonc must contain default, staging, and production d1_databases arrays (found ${ranges.length})`,
    );
  }
  const range = ranges[envRangeIndex(env)];
  const slice = jsonc.slice(range.open, range.close + 1);
  if (slice.includes(`"binding": "${spec.binding}"`)) {
    const nextSlice = replaceExistingBinding(slice, spec);
    return jsonc.slice(0, range.open) + nextSlice + jsonc.slice(range.close + 1);
  }
  const indent = "      ";
  const inner = jsonc.slice(range.open + 1, range.close);
  const trimmed = inner.replace(/\/\/[^\n]*/g, "").trim();
  const prefix = trimmed.length > 0 ? "," : "";
  const insertion = `${prefix}\n${formatBinding(spec, indent)}`;
  return jsonc.slice(0, range.close) + insertion + jsonc.slice(range.close);
}

export function hasD1Binding(jsonc: string, env: WranglerD1Env, binding: string): boolean {
  const ranges = findJsoncArrayRanges(jsonc, "d1_databases");
  if (ranges.length < 3) return false;
  const range = ranges[envRangeIndex(env)];
  return jsonc.slice(range.open, range.close + 1).includes(`"binding": "${binding}"`);
}
