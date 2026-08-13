import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GPU_HEALTH_URL = "https://gpu.theallodium.org/api/health";
const TIMEOUT_MS = 15_000;
const EVIDENCE_PATH = resolve("evidence/gpu-smoke.json");

interface GpuHealthBody {
  status?: string;
  ollama?: boolean;
  model?: string | null;
}

interface GpuSmokeEvidence {
  at: string;
  url: string;
  http_status: number | null;
  elapsed_ms: number;
  body: GpuHealthBody | null;
  ok: boolean;
  error?: string;
}

function writeEvidence(evidence: GpuSmokeEvidence): void {
  mkdirSync("evidence", { recursive: true });
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
  console.log(`Wrote ${EVIDENCE_PATH}`);
}

async function main() {
  const at = new Date().toISOString();
  const started = Date.now();
  console.log(`GET ${GPU_HEALTH_URL} (${TIMEOUT_MS}ms timeout)…`);

  try {
    const res = await fetch(GPU_HEALTH_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const elapsed_ms = Date.now() - started;
    const text = await res.text();
    let body: GpuHealthBody | null = null;
    try {
      body = JSON.parse(text) as GpuHealthBody;
    } catch {
      body = null;
    }
    const statusOk = body?.status === "ok" || body?.status === "degraded";
    const ok = res.status === 200 && statusOk;
    writeEvidence({
      at,
      url: GPU_HEALTH_URL,
      http_status: res.status,
      elapsed_ms,
      body,
      ok,
      ...(ok
        ? {}
        : {
            error: statusOk
              ? `HTTP ${res.status}`
              : `unexpected status field: ${JSON.stringify(body?.status)}`,
          }),
    });
    if (!ok) {
      console.error(
        `FAIL HTTP ${res.status} status=${JSON.stringify(body?.status)} (${elapsed_ms}ms)`,
      );
      process.exit(1);
    }
    console.log(`PASS HTTP ${res.status} status=${body?.status} (${elapsed_ms}ms)`);
  } catch (err) {
    const elapsed_ms = Date.now() - started;
    const error = err instanceof Error ? err.message : String(err);
    writeEvidence({
      at,
      url: GPU_HEALTH_URL,
      http_status: null,
      elapsed_ms,
      body: null,
      ok: false,
      error,
    });
    console.error(`FAIL connection/timeout: ${error} (${elapsed_ms}ms)`);
    process.exit(1);
  }
}

main();
