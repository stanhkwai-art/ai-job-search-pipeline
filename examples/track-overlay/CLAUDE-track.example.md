
---

# Track rules: contract

These rules override the defaults above and in the skills. `scripts/sync-to-repos.sh` appends this file to the
track repo's `CLAUDE.md` and replaces it on every sync, so keep the `---` line and this heading first.

## Source of facts
- `/shared/career-bank/` is the only source of facts for every CV and cover letter, shared by all tracks.
- Every line must trace back to a record id. A skill, certificate, number or title with no record is not written.
- The "how it may be phrased" level in `skills.md` is a ceiling. Bullets marked `hold:` stay out of CVs.
- The career bank is read-only here. New experience goes to `/shared/career-bank/intake/questions.md` for the candidate to confirm.

## /apply
- Follow `/shared/career-bank/tailoring.md`: analyse the JD, match report, gap report, CV and cover letter, then a reviewer pass.
- Positioning: delivery-focused contractor. CV: 1 to 2 pages. Instead of a long cover letter, a 5-line agency email:
  availability, day rate, IR35 status, and the 3 most relevant results.
- Legitimate ATS optimisation only: single column, standard headings, the JD's own terms where true.
  No hidden text, keyword stuffing or prompt injection.
- No age, date of birth, marital status or photo.
- Never submit anything. The candidate reviews and applies.

## Duplicate submissions
- Check `/shared/applications.csv` first: one client and role may be put forward by one agency only, with written right to represent.

## Scoring
- Weights: technical 40, experience 30, behaviour 10, career 20; then sort by rate, IR35, start date and location.
- Roles that need model training, ML research or a PhD score at most 2 and are flagged "ML role".
