#!/usr/bin/env bash
# Recurring production link-integrity monitor, installed into this machine's
# crontab (see README's "Continuous monitoring" section). Cron runs with a
# minimal PATH/environment, so this wrapper pins the exact node/npm used
# elsewhere in this project rather than relying on interactive-shell PATH
# setup, and logs every run (pass or fail) to one append-only file so drift
# is visible without needing email/Slack wired up.
set -euo pipefail

REPO_DIR="/tank/TheAllodium"
LOG_FILE="$REPO_DIR/evidence/cron-audit-links.log"
NODE_BIN_DIR="/home/selis/.nvm/versions/node/v24.4.1/bin"

mkdir -p "$REPO_DIR/evidence"
export PATH="$NODE_BIN_DIR:$PATH"

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) starting audit:links against production ==="
  cd "$REPO_DIR"
  if npm run audit:links -- --url https://theallodium.org --env production; then
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) PASSED ==="
  else
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED (see evidence/audit-link-integrity-*.json written above for details) ==="
    exit 1
  fi
} >> "$LOG_FILE" 2>&1
