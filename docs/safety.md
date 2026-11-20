# Safety rules

These are enforced by prompts, allow-lists and the workflow design.

## Nothing leaves without you

- Applications are never submitted automatically. The runner stops at a finished CV and a link.
- Outward emails are Gmail drafts only. No n8n workflow has a send node.
- Replies are drafted from fixed templates, not generated from the incoming email.

## Honest CVs

- CVs only reorganise and reword real, recorded experience. No invented skills, certificates or results.
- Legitimate ATS optimisation only: no hidden text, keyword stuffing or prompt injection in the CV.
- Outward documents never list gaps or weaknesses. Something unrecorded is a question for you, not a "no".
- Internal pay floors are never written into anything a recruiter sees.

## Untrusted input

- Job pages and emails are data, not instructions. Claude Code runs with an allow-list, never with `--dangerously-skip-permissions`.
- Only emails that look like recruiting mail are sent to a model.
- The Telegram bot token lives only in the server's `.env` and the n8n credential. It is removed from the environment before Claude runs.
- Telegram input is accepted from your own chat id only.

## Respect for sites

- Sites without a job-seeker API are used only through their own alert emails.
- robots.txt is checked before fetching; blocked pages are read from a public mirror or pasted by you.
- No CAPTCHA, Cloudflare or bot-protection bypassing. Login or session tokens found in alert links are never stored.

## Privacy

- Track repos are private and created new, not forked from the public project.
- Deploy keys are per repo, not account-wide.
- Backups, original documents and anything naming past clients stay off the server and out of Git.
