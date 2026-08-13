/** Optional Selis GPU bridge. Absence is a boolean false / null, never an
 * exception. The browser never calls this origin — CSP stays default-src
 * 'self'. POST /api/nl-query requires GPU_SHARED_SECRET. */

export const GPU_PING_TIMEOUT_MS = 500;
export const GPU_NL_TIMEOUT_MS = 1500;

export type GpuEnv = {
  GPU_ORIGIN?: string;
  GPU_SHARED_SECRET?: string;
};

function gpuOrigin(env: GpuEnv): string | null {
  const origin = env.GPU_ORIGIN?.trim();
  return origin ? origin.replace(/\/$/, "") : null;
}

export async function pingGpu(env: GpuEnv): Promise<boolean> {
  const origin = gpuOrigin(env);
  if (!origin) return false;
  try {
    const res = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(GPU_PING_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Translate a sentence into a JSON facet suggestion. Returns null on any
 * failure (unset origin/secret, non-OK, timeout, malformed JSON). */
export async function askGpu(env: GpuEnv, text: string): Promise<unknown | null> {
  const origin = gpuOrigin(env);
  const secret = env.GPU_SHARED_SECRET?.trim();
  if (!origin || !secret) return null;
  try {
    const res = await fetch(`${origin}/api/nl-query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(GPU_NL_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}
