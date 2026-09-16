# GPU runbook

Operator-only. Do not link this page from the public site. The live GPU
origin is `gpu.theallodium.org` on the existing `mythsmind-backend`
Cloudflare Tunnel, forwarded to `allodium-gpu-api` on Selis
(`127.0.0.1:8421`). The Worker calls it server-side; the browser never
does.

## Health

Public (hairpin through Cloudflare's edge):

```bash
curl -sS -m 15 https://gpu.theallodium.org/api/health
```

Local (bypasses the tunnel):

```bash
curl -sS -m 5 http://127.0.0.1:8421/api/health
```

HTTP 200 with `"status":"ok"` means the tunnel, the unit, and Ollama are
up, and the preferred model is listed. HTTP 200 with `"status":"degraded"`
means the unit is up but Ollama is missing or the model is not listed.
That is still a pass for `npm run smoke:gpu`. Connection error or
non-200 means the origin is unreachable.

`npm run smoke:gpu` writes `evidence/gpu-smoke.json`. The daily
`scripts/cron-audit-links.sh` job appends the same check to
`evidence/cron-gpu-health.log` and **does not fail** the link-integrity
run if GPU smoke fails.

## Restart order

`cloudflared` is independent of the GPU unit. Do not restart the tunnel
to recover Ollama or the FastAPI origin.

1. `sudo systemctl restart ollama`
2. `sudo systemctl restart allodium-gpu-api`

Then re-check local health, then public health. If local is 200 and
public is not, the problem is the tunnel or DNS, not the unit.

```bash
sudo systemctl status ollama allodium-gpu-api cloudflared --no-pager
```

## Fail-closed

A 502 (or other non-200) on `https://gpu.theallodium.org/api/health` while
`allodium-gpu-api` is stopped is the intended fail-closed path: the
Worker treats a dead origin as "assist offline" and serves keyword
search. Do not add a fake 200 at the tunnel catch-all.

`POST /api/nl-query` refuses every request when `ALLODIUM_GPU_TOKEN` is
unset, and returns 401 for a missing or wrong bearer. The Worker maps
that to the same offline fallback.

## Token

The shared secret lives in `/etc/allodium-gpu.env` (`chmod 600`,
`root:root`), loaded by `allodium-gpu-api.service` via `EnvironmentFile`.
It is **never** in the git-tracked unit file. The Worker side is
`GPU_SHARED_SECRET` via `wrangler secret put` on staging and production.
This is not `CLOUDFLARE_API_TOKEN`.

## What is safe to ignore

- **Cold-start timeouts.** The first NL call after Ollama has been idle
  can take 13–17s. The Worker budget is 1500ms, so that request falls
  back to keyword search. That is the intended degrade, not an outage.
- **`degraded` health.** Tunnel and unit are up; Ollama or the model is
  not. Search still works. Restart Ollama if it should be awake.
- **Leaves contention.** MythsMind Leaves uses the same 3080 Ti /
  `qwen2.5:7b-instruct-q6_k`. Extra fallbacks on either side are
  expected; they are not failures.

## Rate limiting (not this hostname)

Visitor IPs are capped on `theallodium.org/psychotherapy/search?ask=`
(20 requests / 60s / IP, block 429) by
`npm run configure:ask-ratelimit`. If the zone plan is only entitled to a
10s counting period, the script records that fallback (20/10s) in
`evidence/ask-ratelimit.json`. Do **not** rate-limit
`gpu.theallodium.org` itself: Worker fetches share Cloudflare egress
IPs, so an origin cap would collapse every visitor into one bucket.
A 429 is the abuse path; it does not fall through to keyword search.
Timeout / Selis-asleep still does.

Staging `*.workers.dev` is outside the `theallodium.org` zone rule.
