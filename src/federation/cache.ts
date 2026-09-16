const CACHE_VERSION = "federation-v1";
const DEFAULT_TTL_SECONDS = 900;
/** Contract §9: identifier lookups cache for 7 days. */
export const IDENTIFIER_LOOKUP_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SearchCache = {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
};

export type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function federatedSearchCacheKey(
  query: string,
  page: number,
  filters: Readonly<Record<string, string | number | boolean | null>>,
): string {
  const stableFilters = Object.entries(filters)
    .filter(([, value]) => value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right));
  return `${CACHE_VERSION}:${normalizeKeyPart(query)}:${Math.max(1, page)}:${JSON.stringify(stableFilters)}`;
}

export function federatedIdentifierCacheKey(doi: string): string {
  return `${CACHE_VERSION}:doi:${normalizeKeyPart(doi)}`;
}

export function createSearchCache(
  kv: KVNamespace | undefined,
  executionContext?: WaitUntilContext,
): SearchCache {
  return {
    async get<T>(key: string): Promise<T | null> {
      if (kv) {
        const stored = await kv.get<T>(key, "json");
        if (stored !== null) return stored;
      }

      const request = new Request(`https://federation-cache.internal/${encodeURIComponent(key)}`);
      const response = await caches.default.match(request);
      if (!response) return null;
      return (await response.json()) as T;
    },

    async put<T>(
      key: string,
      value: T,
      ttlSeconds = DEFAULT_TTL_SECONDS,
    ): Promise<void> {
      const ttl = Math.max(60, Math.floor(ttlSeconds));
      const writes: Promise<unknown>[] = [];
      if (kv) {
        writes.push(kv.put(key, JSON.stringify(value), { expirationTtl: ttl }));
      }

      const request = new Request(`https://federation-cache.internal/${encodeURIComponent(key)}`);
      const response = Response.json(value, {
        headers: { "Cache-Control": `public, max-age=${ttl}` },
      });
      writes.push(caches.default.put(request, response));
      const allWrites = Promise.all(writes).then(() => undefined);
      if (executionContext) {
        executionContext.waitUntil(allWrites);
      } else {
        await allWrites;
      }
    },
  };
}
