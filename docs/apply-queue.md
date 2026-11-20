# The apply queue and the queue runner

## The queue file

`shared/apply-queue.jsonl` is append-only: one JSON object per line, never rewritten. Writers are n8n WF2 (auto-queued
4+ jobs), n8n WF8 (Telegram), and you (by hand, or from a Claude chat session). The runner reads the whole file on
every pass and folds it into requests keyed by `id`. A line that isn't valid JSON is skipped.

### Line types

| `type` | Fields | Effect |
|---|---|---|
| `job` | `id`, `at`, `track`, `title`, `company`, `url`, `score`?, `jd`?, `needs_jd`?, `hint`?, `source`?, `notes`? | Creates a request. A later `job` line with the same `id` replaces it. |
| `jd` | `id`, `at`, `text` | Appends a part of a pasted job description and clears `needs_jd`. |
| `urgent` | `id`, `at` | Runs now: ignores the night window, the track hold and the budget. |
| `approve` | `id`, `at` | Releases a request on a held track. |
| `prio` | `id`, `at`, `n` | Order within a track; lower runs first (default 999). |
| `last` | `id`, `at` | Runs after everything else. |
| `cancel` | `id`, `at` | Removes the request. Only works before the runner has started it. |

Field notes:

- `score` (1–5) decides the model. Include it when you queue by hand, or the runner looks it up in recent digests.
- `needs_jd: true` marks a LinkedIn or Indeed link. Those pages are never fetched.
- `hint` is the text sent with a link, used to find the same posting elsewhere.
- `notes` holds your instructions for this one application, up to 2,000 characters. Example: *"Lead with ten years of
  regulated-industry leadership; say I will start learning the head office's language after joining."* Notes are added
  to the prompt and never override the truthfulness rules.

See `examples/apply-queue.example.jsonl`.

## Per-request state

Each request gets `shared/apply-out/<id>/`:

| File | Meaning |
|---|---|
| `status` | `running`, `done`, `failed`, `blocked` (no JD could be found) or `superseded` (you re-sent the link with a JD) |
| `jd-input.md` | The JD given to `/apply`, with its source |
| `jd-found.json` | A JD found during the day, kept for the night run |
| `copy-tries`, `freehire-tries` | Times of JD lookups (retry every 30 min, give up after 12 h) |
| `hold-told` | You were told this request waits for approval |
| `claude.log` | Exit code and full output of the `/apply` run |
| `result.json` | Written by `/apply` (see below) |

Runner-wide files: `apply-out/.paused-until` (usage-limit pause), `.budget-runs`, `.budget-told`.

## One runner pass

`scripts/apply-runner.sh` takes a lock and exits if a scrape is running. It reads the bot token and chat id from
`.env` and passes them to `node /shared/bin/apply-runner.mjs` inside the container. The runner then:

1. **Flushes `tg-outbox/`.** Text files there are sent to Telegram and moved to `sent/`. A chat session can message
   you this way without ever seeing the bot token.
2. **Stops if paused** for a usage limit.
3. **Builds the candidate list.** Requests that are ready (3 minutes after the last JD part) and not started. Sorted
   by urgent, not `last`, track order (`TRACK_ORDER`, default `contract uk hk`), then `prio`.
4. **Walks the list** until one request can run:
   - **Held track and not approved:** tell you once, skip.
   - **LinkedIn or Indeed with no JD:** search the freehire.me index for the same title *and* company, still open.
     If nothing is found, ask you to paste the JD (once) and retry every 30 minutes for 12 hours.
   - **JobsDB link with no JD:** fetch the freehire.me mirror whose JobsDB id matches the link exactly. Retry every
     30 minutes for 12 hours, then mark `blocked` and ask for a paste.
   - **Anything else:** ready. Outside the night window, only urgent requests run; a JD found by day is cached.
5. **Checks the budget.** If the cap is used up, tell you once and stop; urgent requests still run.
6. **Picks the model.** Score 4+ → `claude-opus-5-5`; lower, unknown or recruiter jobs → `claude-sonnet-5-5`. A
   budget can force one. `CLAUDE_CODE_SUBAGENT_MODEL` is set to the smaller model.
7. **Runs `/apply`** in `/repos/<track>` with the prompt from `buildPrompt()`. Timeout 45 minutes. The Telegram
   variables are removed from the environment first.
8. **Handles a usage limit.** It reads "resets 11:40pm" from the output, writes `.paused-until`, puts the request
   back and tells you when it will resume.
9. **Reads `result.json`:**

   ```json
   {"folder": "...", "company": "", "role": "", "cv_pdf": "/abs/cv.pdf", "cover_pdf": "/abs/cover.pdf",
    "cover_text": "plain text under 1500 characters",
    "worth_applying": "yes | maybe | no",
    "gaps": ["未有紀錄：… (up to 3 'not yet recorded' items)"],
    "screener": [{"q": "", "a": ""}]}
   ```

   With no `result.json` the request is marked `failed`, with the log tail sent to Telegram. With no CV PDF it is
   marked `blocked`; `/apply` refuses to draft without a JD.
10. **Delivers.** Copies the CV PDF, cover letter PDF and cover text to
    `cv-out/<date>_<company>_<role>/` as `<CV_FILE_PREFIX>CV_<company>_<date>.pdf`. Appends
    `id,date,track,company,role,url,folder` to `apply-log.csv`, marks the request `done`, and sends you the summary,
    the cover text (long-press to copy) and the screener answers.

The runner never submits an application and never emails anyone.

## Environment variables

| Variable | Default | Used for |
|---|---|---|
| `SHARED_DIR` | `/shared` | Shared folder |
| `REPOS_DIR` | `/repos` | Track repos |
| `CLAUDE_BIN` | `claude` | Claude Code binary |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | — | Messages to you (never passed to Claude) |
| `CANDIDATE_NAME` | `the candidate` | How the prompt refers to you |
| `CV_FILE_PREFIX` | empty | File-name prefix, e.g. `Jane_Doe_` |
| `TRACK_ORDER` | `contract uk hk` | Which track's CVs run first |
| `RIGHT_TO_WORK_LINE` | empty | Optional statement for the CV contact block |

## Tests

The runner's helpers (`loadRequests`, `buildPrompt`, `cvRules`, `parseHours`, `inWindow`, `budgetState`,
`limitResetAt`, `scoreFor`, `modelFor`, `heldTracks`, `freehireJD`, `copyJD`, `deliverFiles`, `messages`,
`flushOutbox`) are exported, so you can unit-test them without running Claude. `_setFetch` swaps in a fake `fetch`.
