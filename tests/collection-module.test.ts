import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it, beforeAll } from "vitest";
import minerals from "../fixtures/example-collection/src/index";
import mineralsSql from "../fixtures/example-collection/import.sql?raw";
import mineralsCollectionJson from "../fixtures/example-collection/collection.json?raw";
import mineralsManifest from "../fixtures/example-collection/manifest.json?raw";
import mineralsSource from "../fixtures/example-collection/src/index.tsx?raw";
import collectionFtsSql from "../collection-migrations/0002_fts.sql?raw";
import { INSTALLED_COLLECTION_MODULES } from "../src/collections/installed";
import { createCollectionApp } from "../src/collections/mount";
import { CollectionDb, assertReadOnlySelect } from "../src/collections/db";
import { defineCollection } from "../src/collections/module";
import {
  MODULE_CONTRACT_VERSION,
  V2_ALLOWED_ENTRY_FIELDS,
  V2_FORBIDDEN_FIELDS,
  assertNoForbiddenV2Keys,
  collectionBindingName,
} from "../src/collections/contract-v2";
import { CONTRACT_VERSION, ALLOWED_ENTRY_FIELDS } from "../src/contract";
import { analyzeCollectionSource } from "../src/collections/static-analysis";
import { validateCollectionBundle } from "../src/collections/validate-bundle";
import { parseEntryLinksFromSnapshotSql } from "../scripts/snapshot-sql";
import { upsertD1Binding } from "../scripts/wrangler-d1-binding";
import { sha256Bytes } from "../src/collections/sql";
import { execStatements } from "./sql-test-utils";

const SAMPLE_WRANGLER = `{
  "d1_databases": [
    { "binding": "DB", "database_name": "local-db", "database_id": "00000000-0000-0000-0000-000000000001", "migrations_dir": "migrations" },
    { "binding": "AUTHORITY", "database_name": "local-auth", "database_id": "00000000-0000-0000-0000-000000000002", "migrations_dir": "authority-migrations" }
  ],
  "env": {
    "staging": {
      "d1_databases": [
        { "binding": "DB", "database_name": "stg-db", "database_id": "11111111-0000-0000-0000-000000000001", "migrations_dir": "migrations" },
        { "binding": "AUTHORITY", "database_name": "stg-auth", "database_id": "11111111-0000-0000-0000-000000000002", "migrations_dir": "authority-migrations" }
      ]
    },
    "production": {
      "d1_databases": [
        { "binding": "DB", "database_name": "prd-db", "database_id": "22222222-0000-0000-0000-000000000001", "migrations_dir": "migrations" },
        { "binding": "AUTHORITY", "database_name": "prd-auth", "database_id": "22222222-0000-0000-0000-000000000002", "migrations_dir": "authority-migrations" }
      ]
    }
  }
}
`;

async function loadMinerals() {
  if (!env.COLLECTION_MINERALS) {
    throw new Error("COLLECTION_MINERALS binding missing");
  }
  await execStatements(env.COLLECTION_MINERALS, mineralsSql);
  await execStatements(env.COLLECTION_MINERALS, collectionFtsSql);
}

describe("collection-neutral contract v2", () => {
  it("does not disturb psychotherapy publication contract v1.2", () => {
    expect(CONTRACT_VERSION).toBe("1.2");
    expect(ALLOWED_ENTRY_FIELDS).toContain("therapy_modality");
    expect(ALLOWED_ENTRY_FIELDS).toContain("audience");
  });

  it("omits psychotherapy-specific columns from the v2 allowlist", () => {
    expect(MODULE_CONTRACT_VERSION).toBe("2");
    expect(V2_ALLOWED_ENTRY_FIELDS).not.toContain("therapy_modality");
    expect(V2_ALLOWED_ENTRY_FIELDS).not.toContain("audience");
    expect(V2_FORBIDDEN_FIELDS).toContain("therapy_modality");
  });

  it("rejects forbidden v2 keys", () => {
    expect(() => assertNoForbiddenV2Keys({ id: "x", therapy_modality: "act" })).toThrow(
      /therapy_modality/,
    );
  });

  it("derives the D1 binding name from the slug", () => {
    expect(collectionBindingName("minerals")).toBe("COLLECTION_MINERALS");
    expect(collectionBindingName("soil-science")).toBe("COLLECTION_SOIL_SCIENCE");
  });
});

describe("collection module interface", () => {
  it("does not install the example collection for deploy", () => {
    expect(INSTALLED_COLLECTION_MODULES).toEqual([]);
  });

  it("rejects reserved slugs and empty route tables", () => {
    expect(() =>
      defineCollection({
        slug: "psychotherapy",
        label: "Nope",
        lede: "nope",
        icon: "atom",
        binding: "COLLECTION_X",
        facetCategories: ["topic"],
        nav: [],
        routes: [{ method: "GET", path: "/", handler: () => ({ kind: "text", body: "x" }) }],
      }),
    ).toThrow(/reserved/);
    expect(() =>
      defineCollection({
        slug: "minerals",
        label: "Minerals",
        lede: "n",
        icon: "atom",
        binding: "COLLECTION_MINERALS",
        facetCategories: ["topic"],
        nav: [],
        routes: [],
      }),
    ).toThrow(/at least one route/);
  });

  it("rejects write SQL on the read-only facade", () => {
    expect(() => assertReadOnlySelect("SELECT 1")).not.toThrow();
    expect(() => assertReadOnlySelect("INSERT INTO entries (id) VALUES ('x')")).toThrow(/SELECT/);
    expect(() => assertReadOnlySelect("SELECT 1; SELECT 2")).toThrow(/Multiple/);
    expect(() => assertReadOnlySelect("SELECT * FROM entries; DROP TABLE entries")).toThrow();
  });

  it("flags forbidden imports and host env access", () => {
    const findings = analyzeCollectionSource(
      [
        {
          path: "/tmp/src/index.tsx",
          source: `import { Hono } from "hono";\nconst x = c.env.DB;\nfetch("https://example.org");\n`,
        },
      ],
      "/tmp/src",
      "minerals",
    );
    expect(findings.map((item) => item.message).join("\n")).toMatch(/allowlist/);
    expect(findings.map((item) => item.message).join("\n")).toMatch(/c\.env/);
    expect(findings.map((item) => item.message).join("\n")).toMatch(/fetch/);
  });
});

describe("example minerals collection", () => {
  beforeAll(async () => {
    await loadMinerals();
  });

  it("passes host validation", () => {
    const dir = "/tmp/allodium-example-collection";
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "collection.json"), mineralsCollectionJson);
    writeFileSync(join(dir, "import.sql"), mineralsSql);
    writeFileSync(join(dir, "manifest.json"), mineralsManifest);
    writeFileSync(join(dir, "checksum.txt"), `${sha256Bytes(mineralsSql)}\n`);
    writeFileSync(join(dir, "src", "index.tsx"), mineralsSource);
    const result = validateCollectionBundle(dir);
    expect(result.slug).toBe("minerals");
    expect(result.binding).toBe("COLLECTION_MINERALS");
    expect(result.entryCount).toBe(2);
  });

  it("parses entry links from v2 SQL by column name", () => {
    const links = parseEntryLinksFromSnapshotSql(mineralsSql);
    expect(links.get("aaaaaaaa00000001")?.title).toBe("Basalt Column Primer");
    expect(links.get("aaaaaaaa00000001")?.canonical_url).toBe("https://example.org/basalt");
  });

  it("renders home, search, and an entry through the host adapter", async () => {
    const app = new Hono();
    app.route("/minerals", createCollectionApp(minerals));
    const ctx = createExecutionContext();
    const home = await app.request("/minerals", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    expect(homeHtml).toContain("Minerals");
    expect(homeHtml).toContain("2 entries");

    const searchCtx = createExecutionContext();
    const search = await app.request("/minerals/search", {}, env, searchCtx);
    await waitOnExecutionContext(searchCtx);
    expect(search.status).toBe(200);
    expect(await search.text()).toContain("Basalt Column Primer");

    const entryCtx = createExecutionContext();
    const entry = await app.request("/minerals/entries/aaaaaaaa00000001", {}, env, entryCtx);
    await waitOnExecutionContext(entryCtx);
    expect(entry.status).toBe(200);
    expect(await entry.text()).toContain("columnar basalt");

    const missingCtx = createExecutionContext();
    const missing = await app.request("/minerals/entries/nope", {}, env, missingCtx);
    await waitOnExecutionContext(missingCtx);
    expect(missing.status).toBe(404);
  });

  it("only redirects to targets inside the collection mount", async () => {
    const redirector = defineCollection({
      slug: "minerals",
      label: "Minerals",
      lede: "redirect probe",
      icon: "atom",
      binding: "COLLECTION_MINERALS",
      facetCategories: ["topic"],
      nav: [],
      routes: [
        {
          method: "GET",
          path: "/go",
          handler: (ctx) => ({
            kind: "redirect",
            status: 302,
            location: ctx.request.query("to") ?? "/minerals",
          }),
        },
      ],
    });
    const app = new Hono();
    app.route("/minerals", createCollectionApp(redirector));

    const okCtx = createExecutionContext();
    const ok = await app.request("/minerals/go?to=/minerals/search", {}, env, okCtx);
    await waitOnExecutionContext(okCtx);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/minerals/search");

    // A sibling path that merely shares the slug as a string prefix, an
    // off-site absolute URL, a protocol-relative host, and a relative
    // target the browser would resolve outside the mount.
    for (const target of [
      "/minerals-evil/page",
      "https://evil.example/",
      "//evil.example/",
      "../../psychotherapy/list",
    ]) {
      const ctx = createExecutionContext();
      const res = await app.request(
        `/minerals/go?to=${encodeURIComponent(target)}`,
        {},
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      expect(res.status, `expected ${target} to be refused`).toBe(500);
    }
  });

  it("refuses writes through CollectionDb against the minerals D1", async () => {
    const db = new CollectionDb(env.COLLECTION_MINERALS as D1Database);
    await expect(db.query("DELETE FROM entries")).rejects.toThrow(/SELECT/);
    const rows = await db.query<{ c: number }>("SELECT COUNT(*) AS c FROM entries");
    expect(rows[0]?.c).toBe(2);
  });
});

describe("wrangler D1 binding patcher", () => {
  it("inserts and updates a collection binding in each env array", () => {
    const original = SAMPLE_WRANGLER;
    const withStaging = upsertD1Binding(original, "staging", {
      binding: "COLLECTION_SOIL",
      databaseName: "theallodium-soil-staging",
      databaseId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      migrationsDir: "collection-migrations",
    });
    expect(withStaging).toContain('"binding": "COLLECTION_SOIL"');
    expect(withStaging).toContain("theallodium-soil-staging");
    const updated = upsertD1Binding(withStaging, "staging", {
      binding: "COLLECTION_SOIL",
      databaseName: "theallodium-soil-staging",
      databaseId: "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee",
      migrationsDir: "collection-migrations",
    });
    expect(updated).toContain("ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(updated.split("COLLECTION_SOIL").length).toBe(2);
    expect(original).not.toContain("COLLECTION_SOIL");
  });
});
