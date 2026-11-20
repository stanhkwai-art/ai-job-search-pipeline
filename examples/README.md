# Examples

| File | What it is |
|---|---|
| `.env.example` | Secrets and options for the containers. Copy to `.env` beside `docker-compose.yml`. |
| `apply-queue.example.jsonl` | The CV request queue, one JSON object per line. See `docs/apply-queue.md`. |
| `apply-hours.txt` | The night window for CV runs (`HH:MM-HH:MM`, or `always`). |
| `apply-hold.txt` | Tracks whose CV requests wait for an `approve` line. |
| `apply-budget.example.json` | Optional cap on CV runs between two dates, with an optional forced model. |
| `claude-settings.example.json` | A starting allow/deny list for Claude Code in each track repo (`.claude/settings.local.json`). |
| `track-overlay/` | Example per-track rules, screener answers and search queries. |
| `career-bank-templates/` | Templates for one role file and one project file (comments in Cantonese). |
