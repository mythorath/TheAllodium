import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv } from "./cli";
import { cloudflareApiFetch, getZoneByName } from "./cloudflare-api";

config();

const ORG_DOMAIN = "theallodium.org";
const EVIDENCE_PATH = resolve("evidence/bot-access.json");
const DESIRED = {
  sbfm_definitely_automated: "allow",
  ai_bots_protection: "disabled",
  enable_js: false,
  // Cloudflare's managed robots.txt / Bot Preference Sync prepends
  // AI-training Disallow rules and Content-Signal: ai-train=no. Turn
  // both the prepend and the Content Signals Policy off so origin
  // public/robots.txt is what crawlers see. ai_training "disabled"
  // means do not apply a training restriction (not "allow", which 400s).
  is_robots_txt_managed: false,
  cf_robots_variant: "off",
  bot_preference_sync_enabled: false,
  ai_training: "disabled",
} as const;

const READ_ONLY_KEYS = new Set([
  "using_latest_model",
  "ai_bots_migration_opt_out",
]);

type BotManagementConfig = Record<string, unknown>;

function usage(): never {
  throw new Error(
    `Usage: configure-bot-access.ts --yes\n` +
      `  Idempotently GET-merge-PUTs Super Bot Fight Mode on ${ORG_DOMAIN} so\n` +
      `  automated traffic and AI crawlers are allowed (sbfm_definitely_automated=allow,\n` +
      `  ai_bots_protection=disabled, enable_js=false, is_robots_txt_managed=false,\n` +
      `  cf_robots_variant=off, bot_preference_sync_enabled=false, ai_training=disabled). Writes ${EVIDENCE_PATH}.`,
  );
}

function writableConfig(current: BotManagementConfig): BotManagementConfig {
  const next: BotManagementConfig = {};
  for (const [key, value] of Object.entries(current)) {
    if (!READ_ONLY_KEYS.has(key)) next[key] = value;
  }
  return next;
}

function alreadyDesired(current: BotManagementConfig): boolean {
  return (
    current.sbfm_definitely_automated === DESIRED.sbfm_definitely_automated &&
    current.ai_bots_protection === DESIRED.ai_bots_protection &&
    current.enable_js === DESIRED.enable_js &&
    current.is_robots_txt_managed === DESIRED.is_robots_txt_managed &&
    current.cf_robots_variant === DESIRED.cf_robots_variant &&
    current.bot_preference_sync_enabled === DESIRED.bot_preference_sync_enabled &&
    current.ai_training === DESIRED.ai_training
  );
}

function snapshotFields(config: BotManagementConfig): Record<string, unknown> {
  return {
    sbfm_definitely_automated: config.sbfm_definitely_automated,
    ai_bots_protection: config.ai_bots_protection,
    enable_js: config.enable_js,
    is_robots_txt_managed: config.is_robots_txt_managed,
    cf_robots_variant: config.cf_robots_variant,
    bot_preference_sync_enabled: config.bot_preference_sync_enabled,
    ai_training: config.ai_training,
  };
}

function writeEvidence(evidence: Record<string, unknown>): void {
  mkdirSync("evidence", { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Wrote ${EVIDENCE_PATH}`);
}

async function main() {
  const { booleans } = parseFlags(process.argv.slice(2));
  if (!booleans.has("yes")) usage();

  requireEnv(["CLOUDFLARE_API_TOKEN"]);

  console.log(`Looking up the Cloudflare zone for ${ORG_DOMAIN}…`);
  const zone = await getZoneByName(ORG_DOMAIN);
  console.log(`  zone id=${zone.id}, status=${zone.status}`);

  console.log("GET current bot_management…");
  const current = await cloudflareApiFetch<BotManagementConfig>(
    `/zones/${zone.id}/bot_management`,
  );
  const body = { ...writableConfig(current), ...DESIRED };

  let applied = current;
  if (alreadyDesired(current)) {
    console.log("  already at desired bot-access settings; leaving as-is.");
  } else {
    console.log(
      "  PUT merged bot_management (definitely-automated=allow, AI bots allowed, JS detections off, managed robots.txt and Bot Preference Sync off)…",
    );
    applied = await cloudflareApiFetch<BotManagementConfig>(
      `/zones/${zone.id}/bot_management`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
  }

  if (!alreadyDesired(applied)) {
    throw new Error(
      "bot_management PUT succeeded but desired fields were not applied: " +
        JSON.stringify(snapshotFields(applied)),
    );
  }

  writeEvidence({
    at: new Date().toISOString(),
    zone: ORG_DOMAIN,
    zone_id: zone.id,
    previous: snapshotFields(current),
    applied: snapshotFields(applied),
  });

  console.log(
    `Done. ${ORG_DOMAIN} allows automated traffic and AI crawlers ` +
      `(sbfm_definitely_automated=allow, ai_bots_protection=disabled, enable_js=false, ` +
      `is_robots_txt_managed=false, cf_robots_variant=off, bot_preference_sync_enabled=false, ai_training=disabled).`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  if (/HTTP 403|code":10000|Authentication error|does not have access/i.test(message)) {
    console.error(
      "Token needs Zone → Bot Management → Edit on theallodium.org. " +
        "Account-level access does not imply this Zone permission.",
    );
  }
  process.exit(1);
});
