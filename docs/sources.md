# Safe source boundary

This project finds vacancies only through routes the data owner allows. This page
defines those routes, rejects the rest, and records the intended route for each
portal the author uses.

## Allowed routes

| Route | What it is | Example in this repo |
|-------|-----------|----------------------|
| **Official API** | A documented, public job API used within its terms | `manfred`, `smartrecruiters` |
| **Employer ATS endpoint** | The public JSON a company's own careers page is built on | `greenhouse`, `lever`, `ashby` |

## Rejected routes

- **Scraping or browser automation of a job board** (LinkedIn, Indeed, InfoJobs,
  Michael Page, Tecnoempleo and any other). No navigation, login or HTML parsing.
- **Automatic application.** The tool never submits an application. The apply
  button opens the employer's own page and the human decides.
- **Unauthorized API use**, including APIs whose terms forbid this use (for
  example RemoteOK requires public attribution that a private tool cannot give).
- **Guessing a format.** An email parser is written only against a real saved
  sample.

## Implemented sources

Every source with an adapter today. `fixture` is a local sample file and never
reaches the network; the rest are the allowed routes above, each registered once in
`packages/core/src/adapters/pipeline/source-composition.ts`.

| Id | What it is | Route | Status |
|----|------------|-------|--------|
| `manfred` | Manfred's public job API (archive endpoint; closed offers are filtered out) | Official API | Implemented |
| `smartrecruiters` | SmartRecruiters posting API, covering its company boards | Official API | Implemented |
| `greenhouse` | Employer ATS endpoint, per company board | Employer ATS endpoint | Implemented |
| `lever` | Employer ATS endpoint, per company board | Employer ATS endpoint | Implemented |
| `ashby` | Employer ATS endpoint, per company board | Employer ATS endpoint | Implemented |
| `fixture` | Local sample catalogue, for tests and the sample badge | None (no network) | Implemented |

The web UI labels exactly these six ids and nothing else: a portal without an
adapter has no label, so it cannot appear in the queue by accident.

## Intended route per portal

Portals the author uses that have **no adapter yet**. Nothing here is wired into a
run; each row states the route that would be allowed if one is built.

| Portal | Route today | Status |
|--------|-------------|--------|
| Knowmad Mood | Employer careers site (Teamtailor). A dedicated connector over its public feed, if one is exposed; otherwise email alert or manual import | Not implemented |
| InfoJobs | Official job-search API (needs developer credentials) | Not implemented |
| Tecnoempleo | Integration access by request to the site; until granted, email alert or manual import | Not implemented |
| Indeed | API access is partner-gated. Use email alerts or manual import | Not implemented |
| Michael Page | Email alerts or manual import. A parser needs a real saved sample | Not implemented |
| LinkedIn | Email alerts or manual import only. Never automated | Not implemented |
| Experteer | Saved-search email alerts. It targets senior roles, so it is a poor fit for a first-job search and must stay out of the main queue | Not implemented |

"Not implemented" means no adapter exists yet. Terms of each site can change, so
re-check them before building an adapter.

## Adding a source

1. Confirm the route is in the allowed table and the terms permit it.
2. API or ATS: add a `JobSource` adapter and register it in
   `packages/core/src/adapters/pipeline/source-composition.ts`.

## Last verification (2026-10-23)

A real `npm start -- --source=all` run, no flags skipped, on the author's machine:

| Source | Status | Fetched |
|--------|--------|---------|
| `greenhouse` | ok | 176 |
| `smartrecruiters` | ok | 111 |
| `ashby` | ok | 90 |
| `manfred` | ok | 23 |
| `lever` | ok | 16 |

416 postings fetched, 414 unique, 34 passing both filters. **Nothing failed**, which
was not true before this run: `manfred` used to answer
`request timed out after 15000ms` and the run reported "1 of 5 source queries
failed". The endpoint itself was fine — the offers list is ~2.3 MB and answered in
~9.6 s, and the sitemap ~289 KB in ~8.1 s — so the shared 15 s board default was
simply too tight for it. Manfred now has its own budget: the constant
`MANFRED_TIMEOUT_MS` (45 s, in `packages/core/src/config/manfred.ts`) is passed to
that one source only. It is a code constant, **not** an environment variable -
nothing has to be set for it to apply. The other four boards keep the shared 15 s
default because they answer in well under a second.

### Refuted, with the reason

These were tried and are NOT sources any more. The reason is recorded so nobody
re-adds them by accident:

| Removed | Why |
|---------|-----|
| `adzuna` | Spanish-market yield was negligible for this profile; removed, and the credentials are not referenced anywhere. |
| `arbeitnow` | Same: European board with almost no Spanish junior software offers. |
| `landingjobs` | Same: negligible Spanish yield. |
| Clarity AI (a Greenhouse board) | Its board answers 404; the entry was deleted rather than left as a warning on every run. |

Not a source and never will be: scraping or automating LinkedIn, Indeed, InfoJobs,
Tecnoempleo, Michael Page or Experteer (see the rejected routes above). For those
the only routes are email alerts and manual import.
