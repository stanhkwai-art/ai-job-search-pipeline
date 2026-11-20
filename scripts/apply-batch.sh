#!/bin/sh
# One-off: work through every ready request in shared/apply-queue.jsonl, one /apply at a time.
# Stops at the first run that does not finish with "done", so a setup problem doesn't burn the Claude quota 9 times.
BASE=${BASE:-/volume1/docker/ai-job-search}
LOG=$BASE/shared/apply-runner.log
for i in $(seq 1 ${1:-20}); do
  sh "$(dirname "$0")/apply-runner.sh"
  last=$(tail -n 1 "$LOG")
  echo "$last"
  case "$last" in *" done") ;; *) break ;; esac
done
