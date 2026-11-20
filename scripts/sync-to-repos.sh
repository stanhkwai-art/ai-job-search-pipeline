#!/bin/sh
# Run on the server as root after updating career-bank/ or track-overlay/ in the base folder.
# Pushes career-bank, master CVs, answers.md and the track rules into shared/ and each repo-*.
set -e
cd "${BASE:-/volume1/docker/ai-job-search}"
MARKER=${TRACK_MARKER:-'# Track rules'}   # first heading of track-overlay/<track>/CLAUDE-track.md
TRACKS=${TRACKS:-hk uk contract}

cp -r career-bank/. shared/career-bank/
for T in $TRACKS; do
  cp career-bank/masters/$T.md repo-$T/documents/cv/
  cp track-overlay/$T/answers.md repo-$T/
  # Replace the appended track rules: drop everything from the last "---" before the marker heading, then re-append.
  F=repo-$T/CLAUDE.md
  N=$(grep -n "^$MARKER" "$F" | head -1 | cut -d: -f1)
  if [ -n "$N" ]; then
    K=$(grep -n '^---$' "$F" | awk -F: -v n="$N" '$1<n{l=$1} END{print l}')
    head -n $((K-1)) "$F" > "$F.new"
  else
    cp "$F" "$F.new"
  fi
  cat track-overlay/$T/CLAUDE-track.md >> "$F.new"
  mv "$F.new" "$F"
  echo "$T: $(grep -c "^$MARKER" "$F") track section"
done
for T in $TRACKS; do chown -R 1000:1000 "repo-$T"; done
chown -R 1000:1000 shared
