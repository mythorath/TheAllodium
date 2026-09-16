import { config } from "./load-env";
import { parseFlags, requireEnv } from "./cli";
import { cloudflareApiFetch, ensureDnsRecord, getZoneByName } from "./cloudflare-api";
import { SITE_URL } from "../src/site-config";

config();

const COM_DOMAIN = "theallodium.com";

function usage(): never {
  throw new Error(
    `Usage: configure-com-redirect.ts --yes\n` +
      `  Idempotently ensures placeholder DNS records exist (so the zone is reachable at all) and\n` +
      `  configures a 301 redirect from ${COM_DOMAIN} to ${SITE_URL} via a zone-level Single Redirect\n` +
      "  (Dynamic) rule, no Worker involved, not billed as Worker requests.",
  );
}

async function main() {
  const { booleans } = parseFlags(process.argv.slice(2));
  if (!booleans.has("yes")) usage();

  requireEnv(["CLOUDFLARE_API_TOKEN"]);

  console.log(`Looking up the Cloudflare zone for ${COM_DOMAIN}…`);
  const zone = await getZoneByName(COM_DOMAIN);
  if (zone.status !== "active") {
    throw new Error(
      `Zone ${COM_DOMAIN} is not active (status=${zone.status}): its nameservers likely aren't pointed at Cloudflare yet.`,
    );
  }
  console.log(`  zone id=${zone.id}, status=${zone.status}`);

  // A zone with zero DNS records has no hostname for Cloudflare's edge to
  // route to at all, an edge-side Ruleset (like this redirect) is
  // unreachable without at least one proxied record. This placeholder A
  // record never needs to resolve to a real origin: the redirect rule
  // below runs before any request would reach it.
  console.log(`Ensuring placeholder proxied DNS records exist for ${COM_DOMAIN} (apex + www)…`);
  for (const name of [COM_DOMAIN, `www.${COM_DOMAIN}`]) {
    await ensureDnsRecord(zone.id, {
      type: "A",
      name,
      content: "192.0.2.1",
      proxied: true,
      ttl: 1,
      comment: `Placeholder for the zone-level redirect to ${SITE_URL}; never resolves to a real origin.`,
    });
  }

  // The http_request_dynamic_redirect phase has exactly one ruleset per
  // zone (the "entrypoint" ruleset): PUTing the full desired rule list
  // replaces it wholesale, which is what makes this safely re-runnable.
  const rule = {
    action: "redirect",
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: {
          expression: `concat("${SITE_URL}", http.request.uri.path)`,
        },
        preserve_query_string: true,
      },
    },
    expression: "true",
    description: `Redirect all of ${COM_DOMAIN} to ${SITE_URL}`,
    enabled: true,
  };

  console.log(
    `Applying the http_request_dynamic_redirect entrypoint ruleset for zone ${zone.id} (idempotent replace)…`,
  );
  await cloudflareApiFetch(
    `/zones/${zone.id}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,
    {
      method: "PUT",
      body: JSON.stringify({ rules: [rule] }),
    },
  );

  console.log(
    `Done. ${COM_DOMAIN} now 301-redirects every path (with query string) to ${SITE_URL}.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
