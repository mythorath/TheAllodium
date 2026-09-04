#!/usr/bin/env bash
# Recurring production link-integrity monitor, installed into this machine's
# crontab (see README's "Continuous monitoring" section). Cron runs with a
# minimal PATH/environment, so this wrapper pins the exact node/npm used
# elsewhere in this project rather than relying on interactive-shell PATH
# setup, and logs every run (pass or fail) to one append-only file so drift
# is visible without needing email/Slack wired up.
#
# GPU health is logged separately and is non-fatal: Selis asleep is expected
# and must not fail the daily link-integrity job.
set -euo pipefail

REPO_DIR="/tank/TheAllodium"
LOG_FILE="$REPO_DIR/evidence/cron-audit-links.log"
GPU_LOG_FILE="$REPO_DIR/evidence/cron-gpu-health.log"
FEDERATION_LOG_FILE="$REPO_DIR/evidence/cron-federation-health.log"
NODE_BIN_DIR="/home/selis/.nvm/versions/node/v24.4.1/bin"

mkdir -p "$REPO_DIR/evidence"
export PATH="$NODE_BIN_DIR:$PATH"

audit_status=0
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) starting audit:links against production ==="
  cd "$REPO_DIR"
  if npm run audit:links -- --url https://theallodium.org --env production; then
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) PASSED ==="
  else
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED (see evidence/audit-link-integrity-*.json written above for details) ==="
    audit_status=1
  fi
} >> "$LOG_FILE" 2>&1

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) starting smoke:gpu ==="
  cd "$REPO_DIR"
  if npm run smoke:gpu; then
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) PASSED ==="
  else
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED (non-fatal; Selis asleep is expected) ==="
  fi
} >> "$GPU_LOG_FILE" 2>&1

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) starting audit:federation ==="
  cd "$REPO_DIR"
  if npm run audit:federation; then
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) PASSED ==="
  else
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED (non-fatal; upstream outages are reported on /coverage) ==="
  fi
} >> "$FEDERATION_LOG_FILE" 2>&1

exit "$audit_status"
