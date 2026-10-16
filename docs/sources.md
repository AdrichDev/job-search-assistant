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

## Intended route per portal

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
