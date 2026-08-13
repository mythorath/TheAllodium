import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import app from "../src/index";
import fixtureSql from "../fixtures/spike_fixture.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";

/**
 * Regression guard for the "many tabs open at once" bug class: a shared
 * module-level cache/variable that leaks state between concurrent Worker
 * requests would make one tab's link briefly (or permanently) resolve to
 * whatever entry a *different* concurrent request last touched. A static
 * audit of src/ found no such module-scope mutable state today, but this
 * test pins that invariant so a future memoization/cache shortcut can't
 * reintroduce it silently.
 */
async function loadFixture() {
  await execStatements(env.DB, fixtureSql);
  await execStatements(env.DB, ftsSql);
}

const ENTRY_IDS = [
  "aaaaaaaa00000001",
  "aaaaaaaa00000002",
  "bbbbbbbb00000003",
  "bbbbbbbb00000004",
  "cccccccc00000005",
  "cccccccc00000006",
  "dddddddd00000007",
  "dddddddd00000008",
  "eeeeeeee00000009",
  "eeeeeeee00000010",
  "ffffffff00000011",
  "ffffffff00000012",
];

describe("concurrency: many simultaneous entry-page requests never cross-contaminate", () => {
  beforeAll(async () => {
    await loadFixture();
  });

  it("returns each entry's own id/canonical_url even when dozens of different entries are requested at once", async () => {
    const canonicalUrlById = new Map<string, string>();
    for (const id of ENTRY_IDS) {
      const row = await env.DB.prepare(`SELECT canonical_url FROM entries WHERE id = ?`)
        .bind(id)
        .first<{ canonical_url: string }>();
      canonicalUrlById.set(id, row!.canonical_url);
    }
    // Sanity check the fixture actually gives every id a distinct source --
    // otherwise cross-contamination wouldn't be observable.
    expect(new Set(canonicalUrlById.values()).size).toBe(ENTRY_IDS.length);

    // 5 interleaved rounds over the 12 ids = 60 concurrent requests, fired
    // together via Promise.all so they genuinely overlap in the Worker
    // runtime rather than running strictly sequentially.
    const requestedIds = Array.from({ length: 5 }, () => ENTRY_IDS).flat();

    const results = await Promise.all(
      requestedIds.map(async (id) => {
        const ctx = createExecutionContext();
        const res = await app.request(`/psychotherapy/entries/${id}`, {}, env, ctx);
        await waitOnExecutionContext(ctx);
        const html = await res.text();
        return { id, status: res.status, html };
      }),
    );

    for (const { id, status, html } of results) {
      expect(status).toBe(200);
      expect(html).toContain(`<code>${id}</code>`);
      expect(html).toContain(`href="${canonicalUrlById.get(id)}"`);
      // Never leak a *different* requested entry's source URL into this one.
      for (const otherId of ENTRY_IDS) {
        if (otherId === id) continue;
        expect(html).not.toContain(`href="${canonicalUrlById.get(otherId)}"`);
      }
    }
  });

  it("keeps search results scoped to their own request when many different queries run concurrently", async () => {
    const queries = ["values", "defusion", "depression", "trauma", "distress", "compassion"];
    const requested = Array.from({ length: 4 }, () => queries).flat();

    const results = await Promise.all(
      requested.map(async (q) => {
        const ctx = createExecutionContext();
        const res = await app.request(`/psychotherapy/search?q=${encodeURIComponent(q)}`, {}, env, ctx);
        await waitOnExecutionContext(ctx);
        const html = await res.text();
        return { q, html };
      }),
    );

    for (const { q, html } of results) {
      expect(html).toContain(`value="${q}"`);
    }
  });
});
