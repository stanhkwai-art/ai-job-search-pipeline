# n8n workflows and the queue runner

All outward email is created as **Gmail drafts**; no workflow contains a send node. Telegram messages go only to your own chat id, and incoming Telegram updates from any other chat are ignored.

## WF1: Job alerts (every 30 minutes)

1. Gmail trigger on job-board alert senders, plus any email whose subject looks like a job alert ("job alert", "new jobs", "jobs for you").
2. A Code node extracts title, link, location and pay. It normalises tracking links to the job page so the same job from two alerts dedupes.
3. Routing: each job goes to one track by location and contract terms. Pay below the track floor is dropped when stated; no pay stated is kept and marked "ask".
4. Title gate: obviously unrelated roles are dropped before any model call. Gates handle non-English titles too (for example CJK titles, where `\b` word boundaries don't work).
5. Dedupe against `seen-alerts.csv` and `applications.csv`.
6. Append to `repo-<track>/inbox/<date>.md` for the next `/scrape`.
7. Label the email as processed. An alert the parser can't read is handed to `/scrape` as raw text and reported on Telegram, so a changed email format never loses jobs silently.

## `/scrape` (daily, per track)

Runs `claude -p "/scrape"` in each track repo. It runs the portal CLIs and `site:` web searches from `search-queries.md`, reads the inbox batch, scores every job 1–5, and writes `reports/<date>.json` plus a Markdown report. The inbox batch is moved to `processed/` only if the run succeeds.

## WF2: Morning digest (after the scrape, Mon–Sat)

- Top jobs per track, with score, pay and a ✍️ button for each.
- Jobs scored 4+ that have no CV yet are auto-queued (a small daily cap). Jobs from sites the runner can't read are queued with a "find a copy of the JD" flag.
- Writes `digest/<date>.json` so button taps can be resolved later.

## WF8: Apply requests (Telegram, every minute) and the queue runner

WF8 turns Telegram input into lines in `apply-queue.jsonl` (see `docs/telegram.md`).

`apply-runner.mjs` (every 5 minutes, inside the container):

1. Reads the queue. Requests wait 3 minutes after the last pasted JD part, so a long JD can arrive in several messages.
2. **Order:** urgent first, then by track priority (configurable), then queue order. A request can be marked "last in line".
3. **Window, budget and holds:**
   - Outside `apply-hours.txt`, only urgent requests run.
   - `apply-budget.json` caps how many CVs run before a date, for example until the plan's weekly reset. When the cap is reached, Telegram tells you once and the rest wait.
   - Tracks listed in `apply-hold.txt` wait for an `approve` line in the queue, and Telegram tells you once about each waiting job. Urgent requests skip the hold and the budget.
   - Text files dropped into `tg-outbox/` are sent to your Telegram on the next run, so a chat session can send you lists without ever seeing the bot token.
   - JD lookups still run by day, and a JD found by day is cached for the night run.
4. **Getting the JD:**
   - a pasted JD is used as-is;
   - sites that block fetching: look for the same posting on a public job index (matching title and company), retry every 30 minutes for up to 12 hours, then ask you on Telegram to paste it;
   - other links are fetched by `/apply` itself.
5. Runs `claude -p "/apply …" --model <by score>` in the track repo with a 45-minute timeout. The Telegram token is removed from the environment Claude sees. The prompt adds the unattended-run rules (questions go to `gaps.md`), the strengths-only rule for outward documents, the CV quality rules from `cvRules()`, and the request's `notes` if any.
6. `/apply` writes `result.json`: company, role, CV PDF path, cover letter text, verdict (yes / maybe / no), up to three "not yet recorded" items, and suggested screener answers.
7. Copies the PDF and cover letter to `cv-out/`, logs to `apply-log.csv`, and sends a Telegram summary with the application link.
8. If `/apply` could not read the posting, the request is marked `blocked` and Telegram asks you to paste the JD.

## WF7

Reserved for the online-CV update flow (roadmap). There is no WF9.

## WF10: Application receipts (Gmail, every 15 minutes)

Reads "application submitted / received / viewed" emails and adds or updates rows in `applications.csv`. A first manual "backfill" run picks up the last 60 days.

## WF3: Replies from recruiters and employers

Filters for recruiting emails only, so private mail is never sent to a model. Classifies them (interview, rejection, outreach, right-to-represent request, CV update request), updates the matching application row only when exactly one row matches, and drafts replies from fixed templates rather than model text, so an email's content can't steer the reply.

## WF4: Follow-ups (daily)

Applications with no update for 7 days get a polite follow-up **draft** once; after 21 days with no reply they are marked "no response".

## WF5: Recruiter check-ins (daily)

For each recruiter due for contact: a check-in **draft** with availability and recent highlights. It never states a pay floor. When the email is sent from Gmail, the next contact date moves on.

## WF6: Weekly report (Saturday evening)

An HTML report (sent to Telegram as a document, plus a short card) covering:

- jobs scored this week per track, and how many scored 4+;
- CVs made and their scores;
- 4+ jobs without a CV;
- CVs not yet applied for;
- applications from `applications.csv`, trackers and Gmail receipts;
- titles the gate dropped, and alert emails WF1 never read (handed to the next scrape).

## Telegram formatting

Use `parse_mode: HTML` and escape `& < >`. The n8n Telegram node's default Markdown mode breaks on underscores in job titles and URLs.
