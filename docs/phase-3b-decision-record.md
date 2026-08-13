# Phase 3B Decision Record

Generated: 2026-08-13T01:39:00.844Z

## What this phase proved

Phase 3B adds `?ask=` as a one-shot translator from a sentence into the
existing facet/keyword search URL. The GPU is a suggestion generator; the
Worker re-validates every token against D1 allowlists and never keeps
`ask` on the rendered URL (refresh must not re-call Selis).

No Worker deploy this phase. `CONTRACT_VERSION` is unchanged. CSP is
unchanged. Health stays unauthenticated; `POST /api/nl-query` requires a
shared bearer token.

## Shared secret

- FastAPI: `ALLODIUM_GPU_TOKEN` in `/etc/allodium-gpu.env` (`chmod 600`),
  loaded by `allodium-gpu-api.service` via `EnvironmentFile`. The value
  is not in the git-tracked unit file.
- Worker: `GPU_SHARED_SECRET` via `wrangler secret put` on staging and
  production (same value). Local/tests leave it unset so `askGpu` fails
  closed. This is **not** `CLOUDFLARE_API_TOKEN`.

Missing/wrong token → 401 from the origin; the Worker treats that like any
other failure and 302s to `?q={ask}&assist=offline`.

## Timeout

NL calls use **1500ms**, not the 500ms health ping. Phase 3A measured warm
generation at 400–700ms plus tunnel RTT; 500ms would flake while Selis is
awake. Cold start (13–17s) still falls back. Ollama `keep_alive` is 30m
on the chat request.

## Crisis short-circuit

Hotline-intent phrases only (`suicide`, `suicidal`, `kill myself`,
`self-harm`, `want to die`, `end my life`, `better off dead`,
`take my own life`). Catalog topics (`trauma`, `bpd`,
`suicidality` as a search term) still go through NL→facets. Intent match
skips the GPU, 302s to `?q={ask}&crisis=1`, and still runs keyword
search with the existing 988 copy (`CrisisResources`, shared with
`/disclaimer`). Never a dead end.

## Normalization

GPU JSON is mapped case-insensitively onto DISTINCT D1
`therapy_modality` / `resource_type` / topic and hexaflex tag names,
plus the existing kind/audience/decade sets. Hallucinations
(`"research papers"`) are dropped. `access` / `storage` /
`link_status` are not accepted from the model.

## UX

A second labeled field `name="ask"` sits beside `q` on the same GET
form. Success 302s to `buildSearchHref(q, filters)`. Failure 302s to
`?q={ask}&assist=offline` with a quiet notice. Display flags are not
persisted in the form.

Local e2e has no `GPU_ORIGIN`, so Playwright covers the honest degrade
path (offline notice) plus crisis copy. Vitest covers stubbed GPU success,
junk, timeout, 401, and crisis vs trauma.

## Exit gate

- `npm run secrets:scan`, `typecheck`, `test` pass, including
  crisis / normalize / `askGpu` / `?ask=` route tests.
- `npm run test:e2e` passes with zero serious/critical accessibility
  violations.
- Neither staging nor production Worker was deployed this phase.
- `nl-query-rag` stays pending — grounded answers are still deferred.

## Explicitly deferred (3C / later)

- Cloudflare Rate Limiting on `?ask=`
- `smoke:gpu` cron, `/standard` AI disclosure, `docs/gpu-runbook.md`
- Worker deploy
- Grounded RAG answers with citations
- Sending D1 allowlists into the GPU prompt

## Stop

Phase 3B ends here. Do not start 3C until this record is accepted.
