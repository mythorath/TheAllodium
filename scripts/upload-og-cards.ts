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
 * Idempotent: an object that already exists (checked via a HEAD request) is
 * skipped. After a fully successful upload, any *other* checksum prefix
 * already in the bucket is deleted so R2 storage doesn't grow unbounded
 * across promotions — the new set is always uploaded in full before the old
 * one is removed, so an interrupted run never leaves the bucket without a
 * complete, servable generation.
 */

function usage(): never {
  throw new Error(
    "Usage: upload-og-cards.ts --env staging|production --cards-dir <path> --checksum <sha256>\n" +
      "  --checksum is cross-checked against the environment's current snapshot_manifest.checksum\n" +
      "  before any upload happens, so this can never silently target the wrong snapshot generation.",
  );
}

const CONCURRENCY = 12;

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

async function objectExists(accountId: string, bucket: string, key: string): Promise<boolean> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`,
    { method: "HEAD", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } },
  );
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`Unexpected HTTP ${res.status} checking existence of r2://${bucket}/${key}`);
}

async function putObject(accountId: string, bucket: string, key: string, body: Buffer): Promise<void> {
  await cloudflareApiFetch(`/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body,
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
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects?${params}`,
      { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } },
    );
    const body = (await res.json()) as ListObjectsResponse;
    if (!res.ok || !body.success) {
      throw new Error(`Failed to list r2://${bucket}/${prefix}*: ${JSON.stringify(body.errors ?? body)}`);
    }
    keys.push(...body.result.map((o) => o.key));
    if (!body.result_info?.is_truncated || !body.result_info.cursor) break;
    cursor = body.result_info.cursor;
  }
  return keys;
}

async function deletePrefix(accountId: string, bucket: string, prefix: string): Promise<number> {
  const keys = await listAllKeys(accountId, bucket, prefix);
  await runPool(keys, CONCURRENCY, async (key) => {
    await cloudflareApiFetch(`/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`, {
      method: "DELETE",
    });
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

  console.log(`Uploading ${files.length} card(s) from ${cardsDir} to r2://${bucket}/${checksum}/ …`);
  let uploaded = 0;
  let skipped = 0;
  await runPool(files, CONCURRENCY, async (filename) => {
    const key = `${checksum}/${filename}`;
    if (await objectExists(accountId, bucket, key)) {
      skipped += 1;
      return;
    }
    const body = readFileSync(resolve(cardsDir, filename));
    await putObject(accountId, bucket, key, body);
    uploaded += 1;
  });
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
