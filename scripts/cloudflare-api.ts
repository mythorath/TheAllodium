import { requireEnv } from "./cli";

/** Phase 1F: minimal authenticated-fetch helper for the parts of the
 * Cloudflare REST API that Wrangler doesn't cover (zone lookup, Rulesets),
 * everything else in this project goes through `wrangler` subcommands. */

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareApiError {
  code: number;
  message: string;
}

export interface CloudflareApiEnvelope<T> {
  success: boolean;
  errors: CloudflareApiError[];
  messages: unknown[];
  result: T;
}

export async function cloudflareApiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  requireEnv(["CLOUDFLARE_API_TOKEN"]);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = (await res.json()) as CloudflareApiEnvelope<T>;
  if (!res.ok || !body.success) {
    throw new Error(
      `Cloudflare API ${init.method ?? "GET"} ${path} failed (HTTP ${res.status}): ` +
        JSON.stringify(body.errors ?? body),
    );
  }
  return body.result;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export async function getZoneByName(domain: string): Promise<CloudflareZone> {
  const zones = await cloudflareApiFetch<CloudflareZone[]>(
    `/zones?name=${encodeURIComponent(domain)}`,
  );
  const zone = zones[0];
  if (!zone) {
    throw new Error(
      `No Cloudflare zone found for domain "${domain}". Is it added to this account?`,
    );
  }
  return zone;
}

export interface DnsRecordSpec {
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
  comment?: string;
}

interface DnsRecord {
  id: string;
  content: string;
  proxied?: boolean;
}

/**
 * Idempotently ensures a DNS record exists with the given content: needed
 * because a zone with zero DNS records has no hostname for Cloudflare's
 * edge to route to, so a purely edge-side Ruleset (like a redirect) is
 * unreachable without one. Creates it if missing, updates it if it drifted,
 * otherwise leaves it alone.
 */
export async function ensureDnsRecord(
  zoneId: string,
  spec: DnsRecordSpec,
): Promise<void> {
  const existing = await cloudflareApiFetch<DnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=${spec.type}&name=${encodeURIComponent(spec.name)}`,
  );
  const record = existing[0];
  if (!record) {
    await cloudflareApiFetch(`/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify(spec),
    });
    return;
  }
  if (record.content !== spec.content || Boolean(record.proxied) !== Boolean(spec.proxied)) {
    await cloudflareApiFetch(`/zones/${zoneId}/dns_records/${record.id}`, {
      method: "PATCH",
      body: JSON.stringify(spec),
    });
  }
}
