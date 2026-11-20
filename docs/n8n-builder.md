# n8n builder and tests

Hand-editing n8n Code nodes in the browser doesn't scale past a few workflows. Here, every Code node is a plain `.js`
file. `build.py` assembles the workflow JSON, and `test.mjs` runs each Code node against fixtures in Node.

## Layout

```
n8n-builder/
├── build.py        # defines every workflow's nodes and connections; writes out/WF*.json
├── js/
│   ├── lib.js      # shared helpers: CSV parse/write, formula-safe cells, file items, dates, email text
│   ├── fit.js      # title gate per track (English and Chinese titles)
│   ├── wf1.js      # WF1 parse and route (PAY_FLOOR lives here)
│   ├── wf2a.js / wf2b.js            # WF2 report paths / digest and auto-queue
│   ├── wf3a.js / wf3b.js / wf3c.js  # WF3 API requests / apply results / evening digest
│   ├── wf4.js, wf5.js, wf6a.js, wf6.js, wf8.js, wf10.js
└── test.mjs        # 550 assertions
```

Each Code node is `lib.js` followed by its step files, so helpers are shared without an npm package.

## Build

```sh
cd n8n-builder
TELEGRAM_CHAT_ID=123456789 GMAIL_LABEL_ID=Label_123 CANDIDATE_NAME="Jane Doe" N8N_TIMEZONE=Europe/London python3 build.py
```

Unset variables leave placeholders (`REPLACE_TELEGRAM_CHAT_ID`, `REPLACE_GMAIL_LABEL_ID`, `REPLACE_YOUR_NAME`) that
you can replace before import. Credential ids are empty; attach your credentials by name after import:

| Credential name | Type | Notes |
|---|---|---|
| Gmail | Gmail OAuth2 | Redirect `http://localhost:5678/rest/oauth2-credential/callback`. Publish the Google app to production, or the token expires after 7 days. |
| Telegram | Telegram API | Token from @BotFather. Send the bot `/start` once. |
| Anthropic API | Header Auth | Header `x-api-key`. Used by WF3 only, billed per token. |

Create a Gmail label (for example `job-alert/processed`) and put its id in `GMAIL_LABEL_ID`, or pick it in the
*Label processed* nodes after import.

**Pay floors** are in `js/wf1.js`:

```js
const PAY_FLOOR = { hkLeadMonthly: 0, hkMonthly: 0, contractInsideDay: 0, contractOutsideDay: 0 };
```

0 turns a floor off. A job is dropped only when its alert *states* pay below the floor. Jobs with no stated pay are
kept and marked "ask".

## Test

```sh
python3 build.py && node test.mjs     # → PASS 550 assertions
```

The harness loads each generated workflow and runs a Code node with mocked `$`, `$input` and `$now`. It checks:

- **graph integrity:** unique names, no orphans, every `$('Node')` reference exists;
- **no send operations:** a Gmail node may only add labels, list or create drafts;
- **parsing:** alert parsing per board (Indeed, LinkedIn, SEEK/JobsDB, JobServe, sponsored links, unknown formats);
- **filtering and dedupe:** tracking-token removal, routing, title gates, pay floors, dedupe;
- **workflow outputs:** digest numbering and buttons, auto-queue rules, reply classification handling and RTR
  conflicts, follow-up and check-in timing, weekly report numbers and HTML, Telegram commands, receipt parsing;
- **safety:** spreadsheet-formula neutralising, Telegram HTML escaping.

The tests use example pay floors and a placeholder chat id (or `TELEGRAM_CHAT_ID` if you built with one). Fixture
companies are fictional.

## Changing a workflow

1. Edit the step file in `js/` (or the node graph in `build.py`).
2. Add or adjust a test in `test.mjs`.
3. `python3 build.py && node test.mjs`.
4. Import the changed JSON (n8n: *Import from File*, or `n8n import:workflow --input=…` inside the container), then
   **publish it again**: importing unpublishes it.
