# Phase 3A Decision Record

Generated: 2026-08-13T01:36:20.831Z

## What this phase proved

Phase 3A is the GPU-bridge spike: an optional path from the Worker to Selis
that is absent-as-`false`, never an exception. No search UI, no `?ask=`,
no LLM generation. The live origin is `gpu.theallodium.org` on the existing
`mythsmind-backend` Cloudflare Tunnel; the Worker helper is `pingGpu()`
with a 500ms timeout.

No Worker deploy this phase. `CONTRACT_VERSION` is unchanged. CSP is
unchanged (`default-src 'self'` — the browser never calls the GPU origin).

## Token scope

`CLOUDFLARE_API_TOKEN` needed two additions beyond Phase 1F, documented
in `.env.example` and README:

- Zone → DNS → Edit on `theallodium.org` (CNAME)
- Account → Cloudflare Tunnel → Edit (ingress PUT)

GET of the tunnel configuration and of `.org` DNS records already
succeeded with the existing token before the PUT. The configure script's
PUT and CNAME create also succeeded, so both Edit scopes are in place.

## GPU service

`allodium-gpu-api.service` binds `127.0.0.1:8421` only, `Restart=always`,
`Wants=ollama.service`. `GET /api/health` probes Ollama `/api/tags`
(3s timeout) and does **not** load a chat model. HTTP 200 even when Ollama
is down (`status: "degraded"`) so a dead origin is distinguishable from a
dead tunnel.

Preferred model: `qwen2.5:7b-instruct-q6_k` (already kept warm-ish by
MythsMind Leaves; same 3080 Ti). Contention with Leaves is best-effort on
both sides — extra fallbacks, not failures.

## Tunnel merge safety

Tunnel `mythsmind-backend` (`b86db5e6-210e-4b3c-9b08-7359b9f7318e`),
`config_src: cloudflare`. `configure-gpu-tunnel-route.ts` GET-merge-PUTs
ingress and refuses to PUT if `api.mythsmind.com` would drop or the
catch-all would not be last. Resulting ingress:

1. `api.mythsmind.com` → `http://localhost:8420`
2. `gpu.theallodium.org` → `http://localhost:8421`
3. catch-all `http_status:404`

Proxied CNAME: `gpu.theallodium.org` →
`b86db5e6-210e-4b3c-9b08-7359b9f7318e.cfargotunnel.com`.

## Live proof

Public health (hairpin through Cloudflare's edge):

```json
{
  "at": "2026-08-13T00:56:03Z",
  "url": "https://gpu.theallodium.org/api/health",
  "http_status": 200,
  "elapsed_s": 0.14905,
  "dns": "doh:1.1.1.1 (local stub had NXDOMAIN negative cache; public DNS already live)",
  "body": {
    "status": "ok",
    "ollama": true,
    "model": "qwen2.5:7b-instruct-q6_k"
  }
}
```

After `systemctl stop allodium-gpu-api` the same URL failed closed
(non-200, not a hang):

```json
{
  "at": "2026-08-13T00:56:05Z",
  "url": "https://gpu.theallodium.org/api/health",
  "http_status": 502,
  "elapsed_s": 0.13442,
  "body_prefix": "error code: 502\n",
  "service": "stopped"
}
```

Service was restarted and public health returned 200 again.

## Worker helper

`src/gpu.ts` `pingGpu(env)` returns `false` when `GPU_ORIGIN` is
unset/blank, on non-OK HTTP, on network throw, and on abort — and never
throws. Timeout is 500ms. `GPU_ORIGIN` is a wrangler `vars` value on
staging and production only; local/tests leave it unset so the suite never
hits the live GPU. No route calls `pingGpu` yet.

## 3B blocker (do not skip)

Health is unauthenticated so later `smoke:gpu` can hit it without a
secret. **Phase 3B must put a shared secret on `POST /api/nl-query`
before that endpoint exists.** The public hostname is otherwise an open
GPU.

## Exit gate

- `npm run secrets:scan`, `typecheck`, `test` (Vitest, Workers runtime)
  pass, including `tests/gpu.test.ts`.
- `npm run test:e2e` (Playwright + axe-core) passes with zero
  serious/critical accessibility violations — existing suite, no new UI.
- Live evidence: public health 200 + fail-closed after stop.
- Neither staging nor production Worker was deployed this phase.

## Explicitly deferred

- `POST /api/nl-query`, `?ask=`, crisis short-circuit, facet
  normalization (3B).
- Cloudflare Rate Limiting, `smoke:gpu` cron, `/standard` AI
  disclosure, `docs/gpu-runbook.md` (3C).
- Worker deploy to staging/production.
- A new tunnel, Cloudflare Access, or CSP `connect-src` change.
- Grounded RAG answers with citations.

## Stop

Phase 3A ends here. Do not start 3B until this record is accepted.
