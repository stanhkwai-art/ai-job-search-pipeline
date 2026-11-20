#!/bin/sh
# DSM Task Scheduler, as root, every 5 minutes.
# Turns apply requests from Telegram (n8n WF8) into a tailored CV and cover letter, one at a time.
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BASE=${BASE:-/volume1/docker/ai-job-search}   # the folder holding docker-compose.yml, .env and shared/

LOCK=/tmp/ai-job-search-apply.lock
mkdir "$LOCK" 2>/dev/null || exit 0
trap 'rmdir "$LOCK"' EXIT
# Leave the CPU and the Claude quota to the 07:00 scrape while it runs.
[ -d /tmp/ai-job-search-scrape.lock ] && exit 0

TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$BASE/.env")
CHAT=$(sed -n 's/^TELEGRAM_CHAT_ID=//p' "$BASE/.env")
docker exec -u node -e TELEGRAM_BOT_TOKEN="$TOKEN" -e TELEGRAM_CHAT_ID="$CHAT" ai-job-search \
  node /shared/bin/apply-runner.mjs >> "$BASE/shared/apply-runner.log" 2>&1
