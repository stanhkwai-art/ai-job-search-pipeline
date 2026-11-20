# Telegram commands

| You send | What happens |
|---|---|
| Tap ✍️ on a digest job | The job is queued for a CV tonight |
| A job link | Queued; the track is guessed from the link and text |
| `<track> <link>` | Queued on that track |
| `<track> <link>` followed by the JD text | Queued with the pasted JD (no fetching) |
| JD text (over 200 characters) within 30 minutes of a link | Joins that request as the next JD part |
| `urgent` / `急` | The newest queued job runs now, outside the night window |
| `urgent <company>` or `urgent <digest key>` | That job runs now |
| `urgent <link>` | Queued and run now |
| `applied <company>` or `applied <digest key>` | Recorded in `applications.csv` |
| `/help` | Shows these commands |

Messages the runner sends you:

- ⏳ started (with model and score)
- ✅ / 🤔 / ⚠️ the CV and cover letter are ready, with a verdict and the application link
- 📋 can't read this posting: please paste the JD
- ⏸ usage limit reached, resuming at the reset time
- ❌ failed, with the log path
