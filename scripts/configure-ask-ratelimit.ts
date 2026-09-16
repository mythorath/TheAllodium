import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv } from "./cli";
import { cloudflareApiFetch, getZoneByName } from "./cloudflare-api";

config();

const ORG_DOMAIN = "theallodium.org";
const RULE_DESCRIPTION = "Phase 3C: cap ?ask= NL search per IP";
const RULE_EXPRESSION =
  '(http.request.uri.path eq "/psychotherapy/search" and http.request.uri.query contains "ask=")';
const PATH_ONLY_EXPRESSION = 'http.request.uri.path eq "/psychotherapy/search"';
const REQUESTS_PER_PERIOD = 20;
const REQUESTED_PERIOD_SECONDS = 60;
const REQUESTED_MITIGATION_TIMEOUT_SECONDS = 60;
const ENTITLED_PERIOD_SECONDS = 10;
const ENTITLED_MITIGATION_TIMEOUT_SECONDS = 10;
const EVIDENCE_PATH = resolve("evidence/ask-ratelimit.json");

interface RateLimitConfig {
  characteristics: string[];
  period: number;
  requests_per_period: number;
  mitigation_timeout: number;
}

interface RateLimitRule {
  id?: string;
  action: string;
  action_parameters?: {
    response?: {
      status_code: number;
      content: string;
      content_type: string;
    };
  };
  expression: string;
  description?: string;
  enabled?: boolean;
  ratelimit?: RateLimitConfig;
}

interface RateLimitEntrypoint {
  id: string;
  name?: string;
  kind?: string;
  phase?: string;
  rules?: RateLimitRule[];
}

function usage(): never {
  throw new Error(
    `Usage: configure-ask-ratelimit.ts --yes\n` +
      `  Idempotently GET-merge-PUTs an http_ratelimit entrypoint rule on ${ORG_DOMAIN}\n` +
      `  capping GET /psychotherapy/search?ask= at ${REQUESTS_PER_PERIOD} requests / ${REQUESTED_PERIOD_SECONDS}s / IP (block 429).\n` +
      `  Falls back to the zone plan's entitled period/fields if Cloudflare rejects the requested rule.`,
  );
}

interface RuleAttempt {
  expression: string;
  period: number;
  mitigationTimeout: number;
  custom429: boolean;
  label: string;
}

function desiredRule(
  existingId: string | undefined,
  attempt: RuleAttempt,
): RateLimitRule {
  const rule: RateLimitRule = {
    action: "block",
    ratelimit: {
      // cf.colo.id is mandatory on the API even when counting by IP.
      characteristics: ["cf.colo.id", "ip.src"],
      period: attempt.period,
      requests_per_period: REQUESTS_PER_PERIOD,
      mitigation_timeout: attempt.mitigationTimeout,
    },
    expression: attempt.expression,
    description: RULE_DESCRIPTION,
    enabled: true,
  };
  if (attempt.custom429) {
    rule.action_parameters = {
      response: {
        status_code: 429,
        content: "Too many requests",
        content_type: "text/plain",
      },
    };
  }
  if (existingId) rule.id = existingId;
  return rule;
}

function passthroughRule(rule: RateLimitRule): RateLimitRule {
  const kept: RateLimitRule = {
    action: rule.action,
    expression: rule.expression,
  };
  if (rule.id) kept.id = rule.id;
  if (rule.action_parameters) kept.action_parameters = rule.action_parameters;
  if (rule.description !== undefined) kept.description = rule.description;
  if (rule.enabled !== undefined) kept.enabled = rule.enabled;
  if (rule.ratelimit) kept.ratelimit = rule.ratelimit;
  return kept;
}

async function getEntrypoint(zoneId: string): Promise<RateLimitEntrypoint | null> {
  try {
    return await cloudflareApiFetch<RateLimitEntrypoint>(
      `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("HTTP 404")) return null;
    throw err;
  }
}

function mergeRules(existing: RateLimitRule[], attempt: RuleAttempt): RateLimitRule[] {
  const rules = existing.map(passthroughRule);
  const idx = rules.findIndex((rule) => rule.description === RULE_DESCRIPTION);
  if (idx === -1) {
    rules.push(desiredRule(undefined, attempt));
  } else {
    rules[idx] = desiredRule(rules[idx]?.id, attempt);
  }
  return rules;
}

function isEntitlementError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("not entitled") || msg.includes("mitigation_timeout");
}

async function putEntrypoint(
  zoneId: string,
  rules: RateLimitRule[],
): Promise<RateLimitEntrypoint> {
  return cloudflareApiFetch<RateLimitEntrypoint>(
    `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`,
    {
      method: "PUT",
      body: JSON.stringify({ rules }),
    },
  );
}

function writeEvidence(payload: Record<string, unknown>): void {
  mkdirSync("evidence", { recursive: true });
  writeFileSync(EVIDENCE_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${EVIDENCE_PATH}`);
}

async function main() {
  const { booleans } = parseFlags(process.argv.slice(2));
  if (!booleans.has("yes")) usage();

  requireEnv(["CLOUDFLARE_API_TOKEN"]);

  console.log(`Looking up the Cloudflare zone for ${ORG_DOMAIN}…`);
  const zone = await getZoneByName(ORG_DOMAIN);
  console.log(`  zone id=${zone.id}, status=${zone.status}`);

  console.log(
    `GET /zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint (confirm WAF Edit before PUT)…`,
  );
  const current = await getEntrypoint(zone.id);
  const existingRules = current?.rules ?? [];
  console.log(
    current
      ? `  entrypoint id=${current.id}, ${existingRules.length} existing rule(s)`
      : "  no http_ratelimit entrypoint yet (HTTP 404). PUT will create it",
  );

  const attempts: RuleAttempt[] = [
    {
      expression: RULE_EXPRESSION,
      period: REQUESTED_PERIOD_SECONDS,
      mitigationTimeout: REQUESTED_MITIGATION_TIMEOUT_SECONDS,
      custom429: true,
      label: `requested query+path, ${REQUESTS_PER_PERIOD}/${REQUESTED_PERIOD_SECONDS}s, custom 429`,
    },
    {
      expression: RULE_EXPRESSION,
      period: ENTITLED_PERIOD_SECONDS,
      mitigationTimeout: ENTITLED_MITIGATION_TIMEOUT_SECONDS,
      custom429: true,
      label: `query+path, ${REQUESTS_PER_PERIOD}/${ENTITLED_PERIOD_SECONDS}s, custom 429`,
    },
    {
      expression: PATH_ONLY_EXPRESSION,
      period: ENTITLED_PERIOD_SECONDS,
      mitigationTimeout: ENTITLED_MITIGATION_TIMEOUT_SECONDS,
      custom429: true,
      label: `path-only, ${REQUESTS_PER_PERIOD}/${ENTITLED_PERIOD_SECONDS}s, custom 429`,
    },
    {
      expression: PATH_ONLY_EXPRESSION,
      period: ENTITLED_PERIOD_SECONDS,
      mitigationTimeout: ENTITLED_MITIGATION_TIMEOUT_SECONDS,
      custom429: false,
      label: `path-only, ${REQUESTS_PER_PERIOD}/${ENTITLED_PERIOD_SECONDS}s, default block`,
    },
  ];

  let updated: RateLimitEntrypoint | undefined;
  let appliedAttempt: RuleAttempt | undefined;
  let lastError: unknown;
  for (const attempt of attempts) {
    console.log(`PUT merged http_ratelimit entrypoint (${attempt.label})…`);
    try {
      updated = await putEntrypoint(zone.id, mergeRules(existingRules, attempt));
      appliedAttempt = attempt;
      break;
    } catch (err) {
      lastError = err;
      if (!isEntitlementError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  not entitled: ${msg}`);
    }
  }
  if (!updated || !appliedAttempt) {
    throw lastError instanceof Error
      ? lastError
      : new Error("http_ratelimit PUT failed with no entitlement fallback left.");
  }

  const entitlementFallback =
    appliedAttempt.expression !== RULE_EXPRESSION ||
    appliedAttempt.period !== REQUESTED_PERIOD_SECONDS;

  const applied = (updated.rules ?? []).find(
    (rule) => rule.description === RULE_DESCRIPTION,
  );
  if (!applied?.id) {
    throw new Error(
      `PUT succeeded but no rule with description "${RULE_DESCRIPTION}" was returned.`,
    );
  }

  writeEvidence({
    at: new Date().toISOString(),
    zone: ORG_DOMAIN,
    zone_id: zone.id,
    ruleset_id: updated.id,
    rule_id: applied.id,
    description: RULE_DESCRIPTION,
    expression: applied.expression,
    action: applied.action,
    status_code: applied.action_parameters?.response?.status_code ?? 429,
    characteristics: applied.ratelimit?.characteristics ?? [],
    requested_expression: RULE_EXPRESSION,
    requested_period: REQUESTED_PERIOD_SECONDS,
    requested_mitigation_timeout: REQUESTED_MITIGATION_TIMEOUT_SECONDS,
    period: applied.ratelimit?.period,
    requests_per_period: applied.ratelimit?.requests_per_period,
    mitigation_timeout: applied.ratelimit?.mitigation_timeout,
    entitlement_fallback: entitlementFallback,
    fallback_label: appliedAttempt.label,
  });

  console.log(
    `Done. Rule ${applied.id}: ${REQUESTS_PER_PERIOD} req / ${applied.ratelimit?.period}s / ip.src, block 429` +
      (entitlementFallback ? ` (entitlement fallback: ${appliedAttempt.label}).` : "."),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
