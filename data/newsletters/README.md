# Saved job-alert emails

Drop the **plain text of job-alert emails** into this folder. The pipeline reads
them with `npm start -- --source=newsletter`.

## How to add one

1. Subscribe to a job alert (JuniorJobs, a company's careers alert, a job board's
   saved-search email...).
2. When an email arrives, select its body and copy it.
3. Save it here as a `.txt` file. Name it `<sender>-<YYYY-MM-DD>.txt`, e.g.
   `juniorjobs-2026-09-06.txt`. The date in the name is what the pipeline uses as
   the posting date, so it matters.
4. Run `npm start -- --source=newsletter`.

Paste it **verbatim**. Do not tidy it up, retype it or remove the emoji - the
parser was written against the real formatting and the quirks are part of it.

## Which senders work today

Only the **JuniorJobs weekly digest** (numbered Spanish entries with
`juniorjobs.short.gy` links).

Any other file is skipped with a message naming it. That is deliberate: a parser
guessed at from an imagined format produces plausible rows that are wrong, and
this project has already shipped fabricated URLs once. To add a sender, see
`packages/core/src/adapters/newsletter/newsletter-parser.ts`.

## Files the pipeline ignores here

- `.link-cache.json` - the record of which shortener link resolved to which real
  posting. Only written when you pass `--resolve-links`.
- Anything that is not `.txt`, `.eml` or `.text`, including this README.
