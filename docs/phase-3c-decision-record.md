# Phase 3C Decision Record

Generated: 2026-08-13T01:32:16.394Z

## What this phase proved

Phase 3C makes the Selis live layer safe to leave on unattended: a zone
rate-limit on visitor `?ask=` (before any Worker deploy), GPU health
smoke plus a non-fatal daily cron log, public disclosure on `/standard`,
and an operator runbook. Staging then production were deployed with
`smoke:live` and `smoke:gpu` after the rate-limit rule existed.

NL/crisis/normalize behavior is unchanged from 3B. `CONTRACT_VERSION` is
unchanged. CSP is unchanged. `nl-query-rag` stays **pending** — this
phase does not add grounded answers.

## Rate-limit `?ask=` (visitor IPs, not the GPU origin)

The rule is on `theallodium.org`, not `gpu.theallodium.org`. Worker
fetches to the tunnel share Cloudflare egress IPs; limiting the origin
would collapse every visitor into one bucket. `POST /api/nl-query` is
already bearer-gated.

`scripts/configure-ask-ratelimit.ts` GET-merge-PUTs the
`http_ratelimit` entrypoint so existing rules are not wiped. Idempotent
on description `Phase 3C: cap ?ask= NL search per IP`.
Cloudflare requires `cf.colo.id` alongside `ip.src` in
`characteristics`; counting is still per visitor IP.

- Rule id: `cb163ccba96d4b5bab1e7657e1b99999`
- Expression: `http.request.uri.path eq "/psychotherapy/search"`
- Threshold: 20 requests / 10s / IP
  (requested path+query `ask=` at 60s; this zone's WAF plan is not entitled to a 60s period or to `http.request.uri.query` — applied `path-only, 20/10s, custom 429`)
- Action: block 429

**429 is the abuse path.** It does **not** fall through to keyword search.
That degrade is for timeout / Selis-asleep / other origin failure only.

Staging `*.workers.dev` is outside this zone rule; that is accepted.

Token scope added: Zone → WAF → Edit on `theallodium.org`. Confirmed by
GET of the `http_ratelimit` entrypoint before PUT.

## Observability

- `npm run smoke:gpu` GETs `https://gpu.theallodium.org/api/health`
  (15s timeout), passes on HTTP 200 with JSON `status` of `ok` **or**
  `degraded`, writes `evidence/gpu-smoke.json`. Latest run:
  HTTP 200, status `ok`.
- `scripts/cron-audit-links.sh` still fails the job on a link-audit
  failure. GPU smoke after that is appended to
  `evidence/cron-gpu-health.log` and **must not** `exit 1` if Selis is
  asleep. Reinstall is not required; the next 08:00 run picks it up.

## Disclosure and runbook

`/standard` has an "Optional AI-assisted search" section after
Limitations and before Update cadence: optional; keyword/facet always
work; model `qwen2.5:7b-instruct-q6_k`; Worker sends only capped `ask`
text; re-validation drops unknown tokens; offline/timeout → keyword
results; not therapy; crisis-intent skips the model and shows 988.
`docs/gpu-runbook.md` is operator-only and is **not** linked from the
public page.

## Deploy

Rate-limit rule was live before Worker deploys. Staging then production
were deployed with `GPU_SHARED_SECRET` already present from 3B.
Production live smoke (`https://theallodium.org`) at 2026-08-13T01:29:34.809Z:
35 checks, all passing.

## Exit gate

- `npm run secrets:scan`, `typecheck`, `test`, `test:e2e` pass.
- Evidence: `ask-ratelimit.json`, `gpu-smoke.json` (200), production
  `smoke-live-*.json` for `https://theallodium.org`.
- `nl-query-rag` stays pending.

## Explicitly deferred

- Grounded RAG answers, Worker-side KV rate counting, Cloudflare Access,
  CSP `connect-src`
- Rate-limiting `gpu.theallodium.org` itself

## Stop

Phase 3C ends here. The optional NL search path is live and rate-limited.
Do not start grounded RAG until this record is accepted and real usage
exists.
