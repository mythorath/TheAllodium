import { afterEach, describe, expect, it } from "vitest";
import { GPU_NL_TIMEOUT_MS, GPU_PING_TIMEOUT_MS, askGpu, pingGpu } from "../src/gpu";

describe("pingGpu (Phase 3A)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exports a 500ms timeout", () => {
    expect(GPU_PING_TIMEOUT_MS).toBe(500);
  });

  it("returns false when origin is unset without calling fetch", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("no", { status: 500 });
    }) as typeof fetch;

    expect(await pingGpu({})).toBe(false);
    expect(await pingGpu({ GPU_ORIGIN: "   " })).toBe(false);
    expect(called).toBe(false);
  });

  it("returns true on HTTP 200", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as typeof fetch;
    expect(await pingGpu({ GPU_ORIGIN: "https://gpu.theallodium.org" })).toBe(true);
  });

  it("strips a trailing slash on the origin", async () => {
    let url = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      url = String(input);
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    await pingGpu({ GPU_ORIGIN: "https://gpu.theallodium.org/" });
    expect(url).toBe("https://gpu.theallodium.org/api/health");
  });

  it("returns false on HTTP 500", async () => {
    globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
    expect(await pingGpu({ GPU_ORIGIN: "https://gpu.theallodium.org" })).toBe(false);
  });

  it("returns false on a network throw and never rethrows", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await expect(pingGpu({ GPU_ORIGIN: "https://gpu.theallodium.org" })).resolves.toBe(false);
  });

  it("returns false when the request aborts", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;
    await expect(pingGpu({ GPU_ORIGIN: "https://gpu.theallodium.org" })).resolves.toBe(false);
  });
});

describe("askGpu (Phase 3B)", () => {
  const originalFetch = globalThis.fetch;
  const env = {
    GPU_ORIGIN: "https://gpu.theallodium.org",
    GPU_SHARED_SECRET: "test-secret",
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exports a 1500ms timeout", () => {
    expect(GPU_NL_TIMEOUT_MS).toBe(1500);
  });

  it("returns null when origin or secret is unset without calling fetch", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    expect(await askGpu({}, "cbt worksheets")).toBeNull();
    expect(await askGpu({ GPU_ORIGIN: env.GPU_ORIGIN }, "cbt worksheets")).toBeNull();
    expect(await askGpu({ GPU_SHARED_SECRET: env.GPU_SHARED_SECRET }, "cbt worksheets")).toBeNull();
    expect(called).toBe(false);
  });

  it("POSTs JSON with a bearer token and returns parsed JSON", async () => {
    let url = "";
    let method = "";
    let auth = "";
    let body = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      method = init?.method ?? "";
      auth = new Headers(init?.headers).get("Authorization") ?? "";
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ kind: "materials", modality: ["act"] }), {
        status: 200,
      });
    }) as typeof fetch;
    await expect(askGpu(env, "ACT worksheets")).resolves.toEqual({
      kind: "materials",
      modality: ["act"],
    });
    expect(url).toBe("https://gpu.theallodium.org/api/nl-query");
    expect(method).toBe("POST");
    expect(auth).toBe("Bearer test-secret");
    expect(JSON.parse(body)).toEqual({ text: "ACT worksheets" });
  });

  it("returns null on 401, 500, malformed JSON, and throw", async () => {
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
    await expect(askGpu(env, "cbt")).resolves.toBeNull();
    globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
    await expect(askGpu(env, "cbt")).resolves.toBeNull();
    globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    await expect(askGpu(env, "cbt")).resolves.toBeNull();
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await expect(askGpu(env, "cbt")).resolves.toBeNull();
  });
});
