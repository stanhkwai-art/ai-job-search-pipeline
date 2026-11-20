#!/bin/sh
# Run from DSM Task Scheduler (as root) once a day.
# One private repo per search track, each with its own profile, master CV and scoring rules. Example tracks:
#   hk -> senior IT roles in one country
#   uk -> hands-on technical roles in another
#   contract -> day-rate contract roles
# Results go to reports/ and are pushed to GitHub for the iPhone GitHub app.
# Upstream's .gitignore drops *.log and job_scraper/*.md, so nothing else would be committed.
#
# Usage: scrape.sh            run all tracks
#        scrape.sh contract   run one track (for the optional 13:00 schedule)
#        scrape.sh uk contract   run several tracks

# DSM Task Scheduler runs with a minimal PATH that may not include docker.
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

CONTAINER=ai-job-search
TODAY=$(date +%F)
STAMP=$(date +%F-%H%M)
# Daily scraping/scoring runs on a lighter model to save usage.
# Use the stronger default model only for /apply on roles you have chosen.
# A full id, because the "sonnet" alias in a pinned older CLI resolves to an older model.
MODEL=claude-sonnet-5-5
TRACKS=${*:-${TRACKS:-hk uk contract}}

LOCK=/tmp/ai-job-search-scrape.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another scrape is running, exiting"
  exit 1
fi
trap 'rmdir "$LOCK"' EXIT

FAILED=""
for TRACK in $TRACKS; do
  docker exec -u node -e TRACK="$TRACK" -e STAMP="$STAMP" -e MODEL="$MODEL" -e TODAY="$TODAY" "$CONTAINER" bash -c '
    cd "/repos/$TRACK" || exit 1
    mkdir -p logs reports inbox/processing inbox/processed
    # Claude reads this batch only; n8n WF1 keeps appending new alerts to a fresh inbox file meanwhile.
    for F in inbox/*.md; do [ -e "$F" ] && mv "$F" inbox/processing/; done
    claude -p "/scrape" --model "$MODEL" --output-format text \
      > "reports/$STAMP.md" 2>> "logs/scrape-$TODAY.log"
    RC=$?
    # A failed run leaves the batch in processing/ for the next run.
    [ "$RC" -eq 0 ] && for F in inbox/processing/*.md; do [ -e "$F" ] && mv "$F" "inbox/processed/$STAMP-${F##*/}"; done
    if [ "$RC" -ne 0 ]; then
      echo "scrape failed for $TRACK with exit code $RC, see logs/scrape-$TODAY.log on the server" >> "reports/$STAMP.md"
    fi
    # Upstream .gitignore drops reports/, so force-add it for the iPhone GitHub app.
    git add -A && git add -f reports
    git commit -m "scrape $TRACK $STAMP" || echo "nothing new to commit"
    git push
    exit $RC
  ' || FAILED="$FAILED $TRACK"
done

if [ -n "$FAILED" ]; then
  echo "failed tracks:$FAILED"
  exit 1
fi
