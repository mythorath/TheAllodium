import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv } from "./cli";
import { cloudflareApiFetch } from "./cloudflare-api";
import { appendDeploymentsLog, databaseNameFor, gitCommit } from "./deployments-log";
import { remoteQuery } from "./smoke-checks";

config();

/**
 * Phase 2E: uploads a local `og_cards/{checksum}/` directory (produced by
 * ACT's render_og_cards.py) to the OG_CARDS R2 bucket for a given
 * environment, keyed exactly as the Worker's `GET /og/:filename` route
 * reads them: `{checksum}/{entry id}.png`. Concurrent REST PUTs (a plain
 * `wrangler r2 object put` per file would be far too slow at ~5,643 files,
 * each spawning a new CLI process) via a small bounded worker-pool — no new
 * dependency, matching this project's existing hand-rolled-helper style
 * (see cli.ts's own `--flag` parser).
 *
 * Idempotent: which objects already exist is determined by one upfront
 * paginated listing of the checksum prefix (not a HEAD request per file —
 * at ~5,643 files that would double the request count against the R2 REST
 * API's real, observed rate limit of 1,200 requests/300s, which a first,
 * naive per-file-HEAD version of this script hit reproducibly around the
 * 600-object mark). Every PUT also retries with exponential backoff on 429s
 * and other transient failures, since even PUT-only traffic at concurrency
 * 12 can occasionally outrun the limit. After a fully successful upload,
 * any *other* checksum prefix already in the bucket is deleted so R2
 * storage doesn't grow unbounded across promotions — the new set is always
 * uploaded in full before the old one is removed, so an interrupted run
 * never leaves the bucket without a complete, servable generation.
 */

function usage(): never {
  throw new Error(
    "Usage: upload-og-cards.ts --env staging|production --cards-dir <path> --checksum <sha256>\n" +
      "  --checksum is cross-checked against the environment's current snapshot_manifest.checksum\n" +
      "  before any upload happens, so this can never silently target the wrong snapshot generation.",
  );
}

/** The R2 REST API's observed rate limit is 1,200 requests/300s (~4/s), but
 * a burst that trips Cloudflare's general abuse-prevention throttle (error
 * 971, "Please wait and consider throttling your request speed") takes far
 * longer than a few seconds of backoff to clear — observed over a minute of
 * every request failing, including plain LIST calls. Low concurrency plus a
 * fixed per-request pacing delay (see PACING_MS below) keeps sustained
 * throughput well under the limit so that throttle is never triggered,
 * rather than relying on backoff to recover from it after the fact. */
const CONCURRENCY = 2;
const PACING_MS = 400;

function bucketNameFor(env: "staging" | "production"): string {
  return env === "production" ? "theallodium-og-cards-production" : "theallodium-og-cards-staging";
}

/** Minimal bounded-concurrency worker pool — no new dependency. Each of
 * `concurrency` lanes pulls the next item off a shared cursor until the
 * list is exhausted, so slow uploads don't block fast ones behind them. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function lane(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

const MAX_ATTEMPTS = 8;

/** Retries transient failures (429 rate-limiting, 5xx, and network errors)
 * with exponential backoff — the R2 REST API's observed limit is 1,200
 * requests/300s, easily exceeded by a concurrency-12 pool over ~5,643
 * objects without this. */
async function withRetry<T>(description: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const backoffMs = Math.min(2000 * 2 ** (attempt - 1), 60000);
      console.warn(`  retrying ${description} (attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error).message}), waiting ${backoffMs}ms…`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

async function putObject(accountId: string, bucket: string, key: string, body: Buffer): Promise<void> {
  await withRetry(`PUT r2://${bucket}/${key}`, async () => {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "image/png",
        },
        body,
      },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let parsed: { success?: boolean; errors?: unknown };
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (parsed.success === false) {
      throw new Error(`API error: ${JSON.stringify(parsed.errors)}`);
    }
  });
}

interface ListObjectsResponse {
  success: boolean;
  result: Array<{ key: string }>;
  result_info?: { cursor?: string; is_truncated?: boolean };
  errors?: unknown;
}

async function listAllKeys(accountId: string, bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ prefix, per_page: "1000" });
    if (cursor) params.set("cursor", cursor);
    const body = await withRetry(`LIST r2://${bucket}/${prefix}*`, async () => {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects?${params}`,
        { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } },
      );
      const json = (await res.json()) as ListObjectsResponse;
      if (!res.ok || !json.success) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
      }
      return json;
    });
    keys.push(...body.result.map((o) => o.key));
    if (!body.result_info?.is_truncated || !body.result_info.cursor) break;
    cursor = body.result_info.cursor;
  }
  return keys;
}

async function deletePrefix(accountId: string, bucket: string, prefix: string): Promise<number> {
  const keys = await listAllKeys(accountId, bucket, prefix);
  await runPool(keys, CONCURRENCY, async (key) => {
    await withRetry(`DELETE r2://${bucket}/${key}`, () =>
      cloudflareApiFetch(`/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`, {
        method: "DELETE",
      }),
    );
  });
  return keys.length;
}

async function main() {
  const { flags } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") usage();
  const cardsDirFlag = flags["cards-dir"];
  const checksum = flags.checksum;
  if (!cardsDirFlag || !checksum) usage();

  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID as string;
  const bucket = bucketNameFor(env);

  const cardsDir = resolve(cardsDirFlag);
  const files = readdirSync(cardsDir).filter((name) => name.endsWith(".png"));
  if (files.length === 0) {
    throw new Error(`No .png files found in ${cardsDir}`);
  }

  console.log(`Cross-checking --checksum against env=${env}'s live snapshot_manifest…`);
  const manifestRows = remoteQuery(env, "SELECT checksum FROM snapshot_manifest WHERE id = 1;");
  const liveChecksum = (manifestRows.rows[0] as { checksum?: string } | undefined)?.checksum;
  if (!liveChecksum) {
    throw new Error(`No snapshot_manifest row found on env=${env} — promote a snapshot first.`);
  }
  if (liveChecksum !== checksum) {
    throw new Error(
      `--checksum ${checksum} does not match env=${env}'s live snapshot_manifest.checksum ${liveChecksum} — ` +
        "refusing to upload cards for a different snapshot generation than what's actually deployed.",
    );
  }

  console.log(`Listing already-uploaded objects under r2://${bucket}/${checksum}/ …`);
  const existingKeys = new Set(await listAllKeys(accountId, bucket, `${checksum}/`));
  console.log(`  ${existingKeys.size} already present`);

  const toUpload = files.filter((filename) => !existingKeys.has(`${checksum}/${filename}`));
  console.log(`Uploading ${toUpload.length} new card(s) from ${cardsDir} to r2://${bucket}/${checksum}/ …`);
  let uploaded = 0;
  await runPool(toUpload, CONCURRENCY, async (filename) => {
    const key = `${checksum}/${filename}`;
    const body = readFileSync(resolve(cardsDir, filename));
    await putObject(accountId, bucket, key, body);
    uploaded += 1;
    if (uploaded % 250 === 0) console.log(`  uploaded ${uploaded}/${toUpload.length}…`);
    await sleep(PACING_MS);
  });
  const skipped = files.length - toUpload.length;
  console.log(`  uploaded: ${uploaded}  skipped (already present): ${skipped}`);

  console.log("Looking for a previous checksum prefix to prune…");
  const allKeys = await listAllKeys(accountId, bucket, "");
  const otherPrefixes = new Set(
    allKeys.map((key) => key.split("/")[0]).filter((prefix) => prefix && prefix !== checksum),
  );

  let prunedChecksum: string | null = null;
  let prunedCount = 0;
  for (const prefix of otherPrefixes) {
    const count = await deletePrefix(accountId, bucket, `${prefix}/`);
    console.log(`  pruned ${count} object(s) under previous checksum ${prefix}/`);
    prunedChecksum = prefix;
    prunedCount += count;
  }
  if (otherPrefixes.size === 0) {
    console.log("  no previous checksum prefix found — nothing to prune");
  }

  appendDeploymentsLog({
    type: "og-card-upload",
    at: new Date().toISOString(),
    env,
    databaseName: databaseNameFor(env),
    bucketName: bucket,
    checksum,
    cardCount: uploaded + skipped,
    prunedChecksum,
    prunedCount,
    gitCommit: gitCommit(),
  });

  console.log(`OG card upload to env=${env} complete.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
