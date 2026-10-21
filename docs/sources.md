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
| `landingjobs` | `landing.jobs` public jobs API | Official API | Implemented |
| `arbeitnow` | Arbeitnow's free, key-less European job-board API (terms travel in the payload) | Official API | Implemented |
| `greenhouse` | Employer ATS endpoint, per company board | Employer ATS endpoint | Implemented |
| `lever` | Employer ATS endpoint, per company board | Employer ATS endpoint | Implemented |
| `ashby` | Employer ATS endpoint, per company board | Employer ATS endpoint | Implemented |
| `fixture` | Local sample catalogue, for tests and the sample badge | None (no network) | Implemented |

The web UI labels exactly these eight ids and nothing else: a portal without an
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
