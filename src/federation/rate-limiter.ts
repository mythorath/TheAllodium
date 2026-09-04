export type UpstreamRateLimits = {
  capacity: number;
  refillPerSecond: number;
};

type BucketState = {
  tokens: number;
  updatedAt: number;
};

type PermitResponse = {
  allowed: boolean;
  retryAfterMs: number;
};

const LIMITS: Readonly<Record<string, UpstreamRateLimits>> = {
  crossref: { capacity: 3, refillPerSecond: 3 },
  pubmed: { capacity: 3, refillPerSecond: 3 },
  zenodo: { capacity: 30, refillPerSecond: 0.5 },
  arxiv: { capacity: 1, refillPerSecond: 1 / 3 },
  default: { capacity: 5, refillPerSecond: 1 },
};

export function limitsForSource(source: string): UpstreamRateLimits {
  return LIMITS[source] ?? LIMITS.default;
}

export class UpstreamRateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    const url = new URL(request.url);
    const source = url.searchParams.get("source")?.trim().toLowerCase() ?? "default";
    const limits = limitsForSource(source);
    const now = Date.now();

    const result = await this.state.storage.transaction(async (storage) => {
      const previous = (await storage.get<BucketState>("bucket")) ?? {
        tokens: limits.capacity,
        updatedAt: now,
      };
      const elapsedSeconds = Math.max(0, now - previous.updatedAt) / 1_000;
      const tokens = Math.min(
        limits.capacity,
        previous.tokens + elapsedSeconds * limits.refillPerSecond,
      );
      const allowed = tokens >= 1;
      const remaining = allowed ? tokens - 1 : tokens;
      await storage.put<BucketState>("bucket", { tokens: remaining, updatedAt: now });
      const retryAfterMs = allowed
        ? 0
        : Math.ceil(((1 - remaining) / limits.refillPerSecond) * 1_000);
      return { allowed, retryAfterMs } satisfies PermitResponse;
    });

    return Response.json(result, {
      status: result.allowed ? 200 : 429,
      headers: result.allowed
        ? undefined
        : { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))) },
    });
  }
}

export async function requestUpstreamPermit(
  namespace: DurableObjectNamespace | undefined,
  source: string,
): Promise<PermitResponse> {
  if (!namespace) {
    return { allowed: true, retryAfterMs: 0 };
  }
  const stub = namespace.get(namespace.idFromName(source));
  const response = await stub.fetch(
    `https://upstream-rate-limiter.internal/permit?source=${encodeURIComponent(source)}`,
    { method: "POST" },
  );
  const body = (await response.json()) as Partial<PermitResponse>;
  return {
    allowed: response.ok && body.allowed === true,
    retryAfterMs:
      typeof body.retryAfterMs === "number" && Number.isFinite(body.retryAfterMs)
        ? Math.max(0, body.retryAfterMs)
        : 1_000,
  };
}
