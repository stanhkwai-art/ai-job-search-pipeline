# Architecture and setup

## Containers

| Container | Image | Role |
|---|---|---|
| `jobsearch` | Node + Claude Code + LaTeX (built locally) | Runs `/scrape` and `/apply` inside each track repo |
| `n8n` | `n8nio/n8n` | Email intake, Telegram bot, reports, follow-up drafts |

Both mount a shared folder. n8n also mounts each track repo's `inbox/` and `reports/`.
The n8n editor listens on `127.0.0.1` only. Reach it over an SSH tunnel:

```sh
ssh -L 5678:localhost:5678 <user>@<server>
```

(Google OAuth accepts `http://localhost` as a redirect, but not a LAN IP.)

## Folder layout on the server

```
ai-job-search/
├── docker-compose.yml      # from docker-compose.example.yml
├── Dockerfile
├── .env                    # from examples/.env.example (never commit)
├── scrape.sh               # scripts/scrape.sh: daily scrape, one track after another
├── apply-runner.sh         # scripts/apply-runner.sh: every 5 min, runs the queue runner in the container
├── sync-to-repos.sh        # scripts/sync-to-repos.sh
├── track-overlay/<track>/  # CLAUDE-track.md, answers.md, search-queries.md
├── career-bank/            # source of truth for your experience (see career-bank.md)
├── repo-<track>/           # one private clone of ai-job-search per track
├── home/                   # container user's home (Claude login, SSH deploy keys)
├── n8n-data/
└── shared/                 # mounted into both containers
    ├── applications.csv    # every application, for dedupe and follow-ups
    ├── agencies.csv        # recruiters, cadence, last contact
    ├── seen-alerts.csv     # jobs already taken in from alerts
    ├── apply-queue.jsonl   # CV requests (append-only)
    ├── apply-hours.txt     # night window, e.g. "00:00-08:00" or "always"
    ├── apply-hold.txt      # tracks whose requests wait for an approve line
    ├── apply-budget.json   # optional run cap between two dates
    ├── apply-log.csv       # one row per finished CV
    ├── tg-outbox/          # text files sent to your Telegram on the next runner pass
    ├── apply-out/<id>/     # per-request status, logs, result.json
    ├── cv-out/<date_company_role>/   # finished CV PDF + cover letter
    ├── digest/<date>.json  # what the morning digest showed (for button taps)
    ├── weekly/<date>.html  # weekly report
    └── bin/apply-runner.mjs
```

## Setup steps

1. **Check that Claude Code runs on your CPU.** Some low-power NAS CPUs lack AVX, which the native Claude Code binary needs. Test with a throwaway container first; if it fails, run the `jobsearch` container on another machine and mount the shared folder over NFS.
2. **Create the track repos.** For each track, clone ai-job-search into `repo-<track>` and push it to a **new private** repo (not a fork). Give the container a per-repo deploy key with write access rather than an account-wide key: the container reads web pages, so a leaked key should only expose one repo.
3. **Build and start.** Copy `examples/.env.example` to `.env` and `docker-compose.example.yml` to `docker-compose.yml`. Then `docker build -t ai-job-search-jobsearch:latest .` and `docker compose up -d`. On Synology, use the classic builder (`DOCKER_BUILDKIT=0`) if BuildKit reports a seccomp error.
4. **Log in and set up each track.** Inside the container, run `claude` once to log in (or set `CLAUDE_CODE_OAUTH_TOKEN` in `.env` for unattended use). Then in each repo, run `/setup` against your master CV, disable portal skills you don't use, add portals with `/add-portal` where the site allows automated access, and append `track-overlay/<track>/CLAUDE-track.md` to the repo's `CLAUDE.md`.
5. **Allow-list, don't skip permissions.** Run `claude -p '/scrape'` by hand once per track and add the commands it needs to `.claude/settings.local.json`. Never use `--dangerously-skip-permissions`: job pages are untrusted input.
6. **Generate and import the n8n workflows** (see `n8n-builder.md`): `python3 build.py`, `node test.mjs`, then import `out/*.json`, attach the Gmail, Telegram and Anthropic credentials, set `PAY_FLOOR` in WF1's *Parse and route* node if you want floors, and publish each one. Importing from the CLI unpublishes a workflow, so publish it again afterwards.
7. **Schedule.**
   - `scrape.sh` daily at 07:00 (Mon–Sat is enough).
   - `apply-runner.sh` every 5 minutes, with `bin/apply-runner.mjs` copied to `shared/bin/`.
   - Optional second contract-track scrape at midday, since contract roles move fast.

## Models and cost control

| Run | Model |
|---|---|
| Daily `/scrape` | smaller model (e.g. Sonnet) |
| `/apply` for a job scored 4+ | strongest model (e.g. Opus) |
| `/apply` for lower or unscored jobs | smaller model |
| `/apply` helper subagents (posting fetcher, reviewer) | smaller model, via `CLAUDE_CODE_SUBAGENT_MODEL` |

Use full model ids rather than aliases in scripts: an older pinned CLI can map an alias to an older model.

The runner does one job at a time inside the night window. When the subscription's usage limit is hit, it reads the reset time from Claude's output, writes `apply-out/.paused-until`, re-queues the job and resumes after the reset.
