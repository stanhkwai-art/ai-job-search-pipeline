# Career bank

The career bank is the single source of truth for every CV. `/apply` may only select, reorder and reword what is recorded here.

```
career-bank/
├── profile.md          # contact, right to work, availability, internal pay notes (never shown to recruiters)
├── skills.md           # each skill with a level: hands-on / working / familiar / conceptual
├── roles/<start>_<employer>.md   # one file per job, achievements as tagged bullets with stable ids
├── projects/           # longer project notes
├── masters/<track>.md  # the master CV per track, built from the bullets above
├── tailoring.md        # how each track positions you
└── intake/
    ├── raw/            # drop old CVs and notes here
    ├── questions.md    # open questions for you
    └── log.md          # every change: date, what you said, which files changed
```

Rules:

- Every bullet has an id (for example `<employer>-07`) and appears in the master CV with an HTML comment naming that id, so each CV line can be traced back to its source.
- A skill's level decides how a CV may phrase it: "familiar with" stays "familiar with".
- When a posting asks for something that isn't recorded, `/apply` lists it as "not yet recorded: …" and asks you. It is left out of the CV, cover letter and recruiter email, never written as a weakness.
- When you confirm new experience in chat, it goes into the role file, the masters and the intake log, so the next CV can use it.
- A sync script copies the masters and answers into each track repo, and re-appends the shared track rules to each repo's `CLAUDE.md`.
