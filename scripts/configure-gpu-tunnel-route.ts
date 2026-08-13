import { config } from "./load-env";
import { parseFlags, requireEnv } from "./cli";
import { cloudflareApiFetch, ensureDnsRecord, getZoneByName } from "./cloudflare-api";

config();

const TUNNEL_ID = "b86db5e6-210e-4b3c-9b08-7359b9f7318e";
const TUNNEL_NAME = "mythsmind-backend";
const GPU_HOSTNAME = "gpu.theallodium.org";
const GPU_SERVICE = "http://localhost:8421";
const MYTHSMIND_HOSTNAME = "api.mythsmind.com";
const ORG_DOMAIN = "theallodium.org";

interface TunnelIngressRule {
  hostname?: string;
  path?: string;
  service: string;
  originRequest?: unknown;
}

interface TunnelConfig {
  ingress?: TunnelIngressRule[];
  "warp-routing"?: { enabled: boolean };
  [key: string]: unknown;
}

interface TunnelConfiguration {
  tunnel_id: string;
  config: TunnelConfig;
}

function usage(): never {
  throw new Error(
    `Usage: configure-gpu-tunnel-route.ts --yes\n` +
      `  Idempotently adds ${GPU_HOSTNAME} -> ${GPU_SERVICE} to the existing\n` +
      `  ${TUNNEL_NAME} tunnel (GET-merge-PUT, never drops ${MYTHSMIND_HOSTNAME})\n` +
      `  and ensures a proxied CNAME on ${ORG_DOMAIN}.`,
  );
}

function isCatchAll(rule: TunnelIngressRule): boolean {
  return !rule.hostname || rule.service.startsWith("http_status:");
}

function mergeIngress(existing: TunnelIngressRule[]): TunnelIngressRule[] {
  const ingress = existing.map((rule) => ({ ...rule }));
  const gpu = ingress.find((rule) => rule.hostname === GPU_HOSTNAME);
  if (gpu) {
    gpu.service = GPU_SERVICE;
  } else {
    const rule: TunnelIngressRule = { hostname: GPU_HOSTNAME, service: GPU_SERVICE };
    const catchIdx = ingress.findIndex(isCatchAll);
    if (catchIdx === -1) {
      ingress.push(rule, { service: "http_status:404" });
    } else {
      ingress.splice(catchIdx, 0, rule);
    }
  }

  if (!ingress.some((rule) => rule.hostname === MYTHSMIND_HOSTNAME)) {
    throw new Error(
      `Refusing to PUT tunnel config: merged ingress would drop ${MYTHSMIND_HOSTNAME}.`,
    );
  }
  const last = ingress[ingress.length - 1];
  if (!last || !isCatchAll(last)) {
    throw new Error("Refusing to PUT tunnel config: catch-all rule is not last.");
  }
  if (!ingress.some((rule) => rule.hostname === GPU_HOSTNAME && rule.service === GPU_SERVICE)) {
    throw new Error(`Refusing to PUT tunnel config: missing ${GPU_HOSTNAME} -> ${GPU_SERVICE}.`);
  }
  return ingress;
}

async function main() {
  const { booleans } = parseFlags(process.argv.slice(2));
  if (!booleans.has("yes")) usage();

  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID as string;

  console.log(`GET current config for tunnel ${TUNNEL_NAME} (${TUNNEL_ID})…`);
  const current = await cloudflareApiFetch<TunnelConfiguration>(
    `/accounts/${accountId}/cfd_tunnel/${TUNNEL_ID}/configurations`,
  );
  const currentConfig: TunnelConfig = { ...(current.config ?? {}) };
  const mergedIngress = mergeIngress(currentConfig.ingress ?? []);
  const unchanged =
    JSON.stringify(currentConfig.ingress ?? []) === JSON.stringify(mergedIngress);

  if (unchanged) {
    console.log("  ingress already has the GPU hostname; leaving tunnel config as-is.");
  } else {
    console.log("  PUT merged ingress (preserving existing hostnames)…");
    await cloudflareApiFetch(
      `/accounts/${accountId}/cfd_tunnel/${TUNNEL_ID}/configurations`,
      {
        method: "PUT",
        body: JSON.stringify({
          config: { ...currentConfig, ingress: mergedIngress },
        }),
      },
    );
  }

  console.log(`Ensuring proxied CNAME ${GPU_HOSTNAME} -> ${TUNNEL_ID}.cfargotunnel.com…`);
  const zone = await getZoneByName(ORG_DOMAIN);
  await ensureDnsRecord(zone.id, {
    type: "CNAME",
    name: GPU_HOSTNAME,
    content: `${TUNNEL_ID}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
    comment: `Phase 3A: Cloudflare Tunnel hostname for the Allodium GPU bridge (${TUNNEL_NAME}).`,
  });

  console.log(`Done. ${GPU_HOSTNAME} routes to ${GPU_SERVICE} via ${TUNNEL_NAME}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
