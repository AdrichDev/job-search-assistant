# Job queue — tech offers open to juniors, newest first

A job-search aggregation pipeline for a junior developer in Madrid. It pulls vacancies from public job APIs, collapses duplicates, and applies exactly **two hard filters**: the posting must be software work, and it must carry no explicit signal that a first-job candidate is disqualified. Everything that passes both is shown, newest first. Nothing is ranked away and nothing is truncated — you decide what is worth your time.

A score is still computed and persisted for every offer, but it is a secondary, inspectable detail: it does not order the list and it never removes anything. It exists so that, once there are enough applications logged, it can be correlated against reply rate and either earned its keep or be dropped.

It then tracks **what you applied to and what came of it**, which is the only way to find out whether any of this is any good.

It ships with committed sample data, so it runs end to end with **no API key and no network**.

## Quick path

```bash
npm install
npm start -- --source=boards   # real offers from company boards: no API key, no quota
npm run dev                    # web UI at http://localhost:3000 (in Spanish)
```

Or run fully offline against the committed sample catalogue:

```bash
npm run start:offline     # CLI: table + output/queue.json, no API key, invented data
```

Every row of that run is printed `[SAMPLE]` under a banner saying so, and the
catalogue can never share a run with a real source. See
[Sample data](#sample-data-never-shares-a-run-with-real-vacancies).

`npm run seed:queue` exists but **refuses to run**, on purpose. See
[Restoring the queue](#restoring-the-queue).

`npm run dev` builds the core package first, then starts Next.js. The UI reads the queue the CLI produced; if there is none yet it falls back to the offline sample catalogue, so the first launch is never an empty screen.

**The web UI is in Spanish; the CLI is in English.** Every UI string lives in
`apps/web/src/copy/es.ts` — one file to edit wording, and the seam is already there if a
second locale is ever needed.

To run against the live company boards — **no API key, no signup, no credentials**:

```bash
npm run start:boards      # Greenhouse + Lever + Ashby
```

## Sources

| Source | Kind | Key needed | How coverage is decided |
|--------|------|-----------|-------------------------|
| `fixture` | Committed sample data | No | The catalogue in `data/sample-jobs.json` |
| `greenhouse` | Per-company boards | No | The company list in `config/company-boards.ts` |
| `lever` | Per-company boards | No | Same list |
| `ashby` | Per-company boards | No | Same list |


## Job alerts by email — the widest-reaching source

**[Full workflow below](#reading-job-alerts-from-your-inbox).** In one paragraph:

Most job sites either forbid scraping or render their listings with JavaScript,
so there is nothing to read even if you were allowed to. Michael Page is typical:
no public API, a sitemap that deliberately excludes individual postings, and
category pages built in the browser. But **almost every one of those same sites
will email you the openings if you subscribe to an alert.**

So this pipeline does not visit those sites. You subscribe, you save the emails
into a folder, and it reads the folder. That is legitimate, it does not break
when somebody changes a CSS class, and it works for every sender at once.

### Company boards are not search engines — read this before expecting coverage

Greenhouse, Lever and Ashby have no "find junior React jobs in Madrid" endpoint. Each one only answers
**"what is open at this specific company"**. There is no query to tune and no ranking to improve: the
pipeline sees exactly the employers listed in `packages/core/src/config/company-boards.ts`, and nothing else.

That makes the company list the single most valuable file for coverage. Three working adapters plus an
empty list finds zero jobs.

### Adding a company

1. Find the company's careers page and read the ATS out of the URL:

   | URL you land on | `provider` |
   |-----------------|-----------|
   | `job-boards.greenhouse.io/<slug>` | `greenhouse` |
   | `jobs.lever.co/<slug>` | `lever` |
   | `jobs.ashbyhq.com/<slug>` | `ashby` |
   | `jobs.smartrecruiters.com/<slug>` | `smartrecruiters` |

2. Probe the name. Companies move ATS and slugs vary, so try **all four providers at once** rather
   than assuming a name is absent because one spelling failed:

   ```bash
   npm run verify:boards -- --probe cabify cabify-es grupocabify
   ```

   For a large sweep, put one name per line in a file (`#` starts a comment) and use
   `npm run verify:boards -- --probe-file candidates.txt`.

3. Add the entry to `COMPANY_BOARDS`, recording the date and **both** counts you saw:

   ```ts
   { slug: 'cabify', provider: 'greenhouse', displayName: 'Cabify',
     verifiedOn: '2026-09-10', spainOpeningsAtVerification: 25,
     softwareOpeningsAtVerification: 6 },
   ```

   The provenance fields are not decoration. A slug nobody ever verified looks exactly like a slug that
   works, right up until it silently contributes nothing forever.

#### The bar: all three, not one

A slug is committed only if it passes **every** one of these. `verify:boards` checks all three and
tells you which one a failure hit:

| # | Bar | Why it is separate |
|---|-----|--------------------|
| 1 | **Reachable** — the board answers | — |
| 2 | **Spain** — it has openings located in Spain | On SmartRecruiters an *unknown* company answers `HTTP 200` with `totalFound: 0`. `Telefonica`, `Glovo`, `Santander`, `Indra` and `Inditex` all "succeeded" while being nothing. A status code proves nothing there. |
| 3 | **Software** — at least one of those is a software job | `Sixt` had 35 Spanish openings and every one was a car rental agent. A board whose entire Spanish presence is discarded by the software gate downstream is still a request per run. |

Bar 3 is judged by running the pipeline's **own** `scoreSoftwareRelevance` gate over the postings, not
by reading titles. That cuts both ways: eyeballing would have admitted the staffing firms, and it would
have rejected the Spanish consultancy whose title says only "Consultor/a" with Dynamics 365 named in
the body.

Re-check the whole list at any time — this is the single command:

```bash
npm run verify:boards
```

It prints one group per outcome: boards that pass all three bars (with both counts), then the ones that
failed bar 3, bar 2 and bar 1 respectively.

#### What a 2026-09-10 sweep already ruled out

~300 names were probed across all four providers (~1200 requests). **Spanish IT consultancies are not on
any of these platforms.** Seidor, Ibermática, Ayesa, Sothis, Aitana, Prodware, Hiberus, Plain Concepts,
Encamina, Bilbomática, Intelequia, Softeng, NTT Data, everis, Minsait, Indra, Accenture, Capgemini,
Sopra Steria, Inetum, VASS, Izertis, Babel, Paradigma, Plexus, Alten, Stratesys, Deloitte — plus the
international Dynamics shops (Avanade, Delaware, HSO, Columbus, Fellowmind) and the corporate tech arms
(CaixaBank, Santander, BBVA, Telefónica, Mapfre, Repsol, Iberdrola, Mercadona, Inditex) — all returned
404 or an empty board.

These four ATS are used by venture-backed product companies. Spanish consultancies publish on their own
careers pages, InfoJobs and Tecnoempleo. **Adding slugs cannot reach them; that needs a different
source.** Don't spend another sweep re-proving it.

## Workspace layout

Three npm workspaces:

| Package | What it is |
|---------|-----------|
| `packages/core` | Domain, ports, adapters, the pipeline, the CLI. No UI, no framework. |
| `apps/web` | Next.js App Router UI. Server-side reads only; it holds no credentials. |
| `e2e` | Browser tests that drive the real app. No production code depends on it. |


## What it will never do

See [docs/sources.md](docs/sources.md) for the full safe source boundary: allowed routes, rejected routes and the intended route per portal.

This project does **not** touch LinkedIn. No scraping, no automation, no login, no LinkedIn HTTP calls. LinkedIn's User Agreement §8.2 prohibits automated access, and the penalty is a permanent account ban — an unacceptable risk for someone whose job search depends on that account. The same rule applies to a search API, Greenhouse, Lever, Ashby and every other board: they are read through their public APIs and never driven through a browser.

**Where the browser-automation line actually sits.** The ban is on automating *someone else's* site. Driving a browser against *our own* app on localhost is a different act with none of the same consequences, and it is how the E2E suite works. The two rules together:

- ❌ A browser may never navigate to, log into, or scrape a real job board.
- ✅ A browser may drive `http://127.0.0.1` to check that our own UI is honest.

The E2E harness enforces this in code rather than by convention: every request to a non-localhost origin is aborted at the browser-context level (`e2e/support/test.ts`). Apply links are verified by reading their `href` attribute, never by following them. The suite passes with the network cable unplugged.

## The core design decision

**Wide intake, three hard filters, no ranking.**

Intake stays deliberately wide: sources fetch their own results without pretending that query parameters are a complete eligibility policy. The unified gates run after ingestion, so every source is judged by the same rules.

Exactly three gates run after deduplication:

| | Filter | Rule | Bias |
|---|--------|------|------|
| **A** | Software relevance | Is this software-engineering work at all? A dentist, a sales executive and a treasury clerk are not ranked lower — they are not in the list. | Biased toward inclusion: a role word in the *title* is proof on its own. |
| **B** | Location eligibility | Keep Madrid and nearby locations, hybrid roles in Madrid, remote work performable from Spain, and unknown locations. Exclude explicitly incompatible cities/countries. | Unknown location is kept; incompatible locations get an auditable exclusion reason. |
| **C** | Junior eligibility | Exclude explicit senior, lead or manager roles and requirements of **3+ years**. Keep junior, entry, graduate, trainee, associate and unknown seniority/experience. | Strongly biased toward inclusion: **silence means yes**. |

Every hard exclusion carries a stable audit code (`location_incompatible`, `experience_over_limit` or `seniority_excluded`) and the run summary breaks those counts down. A junior job wrongly dropped is an opportunity that is invisible, to you and to us, permanently. Unknown evidence is therefore kept rather than guessed.

**What is deliberately absent: any score threshold, any top-N cut, any "only show the good ones".**

Ordering is **newest first**. Recency is a fact about the data. It needs no justification, no breakdown panel, and no trust from the person reading it — which a ranking, with no measured reply-rate evidence behind it, has not yet earned.

The score survives as an audit trail you can open per offer:

```
#1 Consultor Junior Power Platform — Nexia Consulting (90.4/100, CV: microsoft)
    seniorityFit  0.80 x 0.34 =  27.2 pts  junior signal in title (junior)
    stackMatch    0.93 x 0.24 =  22.2 pts  Microsoft Power Platform / Dynamics lane: power apps, ...
    locationFit   1.00 x 0.18 =  18.0 pts  based in Madrid
    languageFit   1.00 x 0.14 =  14.0 pts  English requirement within reach (ingles no necesario)
    recency       0.90 x 0.10 =   9.0 pts  posted 3 days ago
```

If you disagree with it, you can see exactly which dimension caused it and change one number in `packages/core/src/config/scoring-config.ts`. It changes the number; it does not change what you see or in what order.

The hard-gate vocabulary is separate from scoring in `packages/core/src/config/junior-filter-config.ts` and `packages/core/src/domain/hard-eligibility.ts`. Scoring remains an explanatory ranking trail; it never overrides a hard exclusion. A title containing `manager` is excluded unless it is explicitly junior, entry-level, graduate, trainee or associate.

## Application tracking

Every click on **Apply** does two things: it opens the real posting in a new tab, and it records an `Application` server-side. You apply on the job board yourself — nothing here logs into anything.

| Field | Why it exists |
|-------|---------------|
| `jobId` | The content fingerprint. One application per vacancy, enforced by the store. |
| `appliedAt` | Frozen history. Never moves. |
| `cvVariant` | Which CV was sent. This is what makes the stats panel worth reading. |
| `scoreAtApply` | The score *at the time*. Retuning the weights later must not rewrite what the scorer believed back then. This is the column the score/reply-rate correlation will eventually be run against. |
| `sourceIds` | Every source that carried the deduplicated vacancy when Apply was clicked. Old records load with an empty list and remain visible as “source not recorded”. |
| `outcome` | `applied` → `no_reply` \| `rejected` \| `screening` \| `interview` \| `offer` |
| `outcomeUpdatedAt`, `notes` | When you last heard something, and what it was. |

The stats panel answers three different questions:

- **Full funnel:** unique vacancies surfaced → applications → responses → advances → interviews → offers. Each percentage is conversion from the preceding stage, and duplicate appearances in the queue, dismissal log and application log count once by `jobId`.
- **By source:** which adapters produce replies and advances. A deduplicated vacancy credits every source that carried it rather than inventing a “winning” source.
- **By CV variant:** whether the Microsoft, frontend or general profile converts better.

A rejection counts as a *response*. A channel that produces rejections is a different problem from one that produces silence, and collapsing them would hide that. A dismissal may also carry one optional, closed-list reason (role, seniority, stack, location, compensation or other); legacy dismissal files without it continue to load.

### The exploration quota is retired

There used to be an exploration quota: 15% of surfaced slots were deliberately sampled from *outside* the top band and labelled, to generate evidence about jobs the ranking did not like.

It only made sense as a counterweight to **score ordering**. With a recency-ordered list that shows everything, there is no top band to be biased toward, so there is nothing left to counteract — the mechanism is not merely unused, it is meaningless. It is gone from the pipeline, the queue DTO, the CLI and the UI.

`domain/exploration.ts` and `config/exploration-config.ts` are kept unwired and still tested, and are no longer exported from the package barrels. They are the two files to delete if score ordering never returns.

### Storage

The application and dismissal logs share one JSON-log store for the mechanics they must agree on: schema validation, refusal to overwrite unreadable data, in-process serialization and atomic writes. Each repository still owns its entity schema and business rules. A uniquely named temp file is written in the same directory and then renamed over the target; a crash leaves either the old complete file or the new complete file, never a truncated one.

There is **no native dependency** — no `better-sqlite3`, nothing needing a postinstall build. `ApplicationRepository` and `DismissalRepository` are the seams for replacing either JSON log without changing callers. Both formats remain version 1 because all new fields are optional and old files load without migration.

## Scoring model

Each dimension returns `0..1`. They are combined with configurable weights and normalized to a `0..100` score.

| Dimension | Weight | What it rewards | What it punishes |
|-----------|--------|-----------------|------------------|
| `seniorityFit` | 0.34 | `junior`, `trainee`, `becario`, `prácticas`, `sin experiencia`, `0-1 años`, `recién titulado` | `senior`, `lead`, `arquitecto`, and any demand of 3+ years |
| `stackMatch` | 0.24 | Best of two lanes plus a shared general bucket | Nothing — a zero here still reaches the output |
| `locationFit` | 0.18 | Madrid, Madrid metro area, hybrid Madrid, remote-Spain | Other Spanish cities on-site; English-first remote-global |
| `languageFit` | 0.14 | No English requirement, or B1/basic | C1/C2/fluent/native, and postings written entirely in English |
| `recency` | 0.10 | Fresh postings | Linear decay to zero over 30 days |

### The two stack lanes

`stackMatch` scores the posting against two named lanes and keeps the winner. The winning lane is written to the job as `cvVariant`, which the future CV-tailoring layer will consume.

| Lane | Keywords (excerpt) | `cvVariant` |
|------|--------------------|-------------|
| `frontend` | react, next.js, typescript, javascript, tailwind, css, html | `"frontend"` |
| `microsoft` | power apps, power automate, dataverse, power pages, dynamics 365, business central, navision, .net, c# | `"microsoft"` |
| *(shared bucket)* | sql, mysql, java, python, git, api, rest, scrum, agile, node | `"general"` when no lane matched |

### Things the scorer gets right on purpose

- `"3 años de experiencia"` is **not** read as junior. Year extraction requires an experience noun near the number, so `"23 días de vacaciones al año"` and `"desde 2026"` are ignored.
- A range takes its upper bound: `"entre 3 y 5 años"` scores as 5, because 5 is what rules you out.
- `senior` in the title costs more than `senior` in the body — `"reportarás al senior developer"` is not a senior vacancy.
- `java` does not match inside `javascript`; `sql` does not match inside `mysql`.
- A C2 English demand down-ranks a job, it never deletes it. Job ads routinely overstate language needs.

**All weights and keyword lists live in `packages/core/src/config/scoring-config.ts`.** The scoring code in `src/domain/scoring/` contains zero keywords.

`extractRequirements` reuses those same lists and the same parsers to derive the chips the UI shows (`yearsRequired`, seniority signals, `matchedStack`, English level, work mode). It owns no vocabulary of its own, so the chips and the score can never tell different stories.

## Architecture

Hexagonal / ports and adapters. The dependency arrow only ever points inward:

```
adapters  ->  app  ->  ports  ->  domain
```

```
packages/core/src/
  domain/          Pure. No I/O, no node builtins, no config imports.
    job.ts           Normalized Job entity + fingerprinting
    text.ts          Normalization, boundary-aware keyword matching
    dedupe.ts        Cross-source / cross-page collapsing
    order.ts         scoreJobs (no sorting) + orderByRecency. Split on purpose.
    junior-eligibility.ts  Filter B. Excludes only on explicit signals.
    application.ts   Application entity + outcome transitions
    application-stats.ts  Response / advance rates, overall and per CV variant
    exploration.ts   RETIRED: seeded exploration sampling, unwired
    requirements.ts  Structured signals for the UI chips
    scoring/         One file per dimension + the weighted combiner
  ports/           Interfaces only: JobSource, QueueWriter, QueueReader,
                   ApplicationRepository, Logger, JobQueue DTO
    identity.ts      Cross-source identity: canonical company + title
  adapters/
    boards/          Per-company board adapters, all zod-validated
      board-http.ts       Bounded concurrency, per-request timeout, User-Agent
      board-location.ts   Location narrowing (never stack filtering)
      board-job-source.ts One JobSource over many company boards
      html-text.ts        Description-field decoder (no HTML parser dependency)
      greenhouse-board.ts / lever-board.ts / ashby-board.ts
    fixture/         Offline adapter reading committed sample data
    pipeline/        source-composition.ts: the ONE table turning source ids into
                     JobSources, shared by the CLI and the web fetch button
    output/          JSON queue writer + zod-validated reader
    persistence/     JSON application log with atomic writes
    logging/         Console logger (writes to stderr)
  app/             buildJobQueue, recordApplication, updateApplicationOutcome
  config/          Candidate profile, scoring weights, search plan, paths, env
  cli/             Argument parsing and table rendering
  index.ts         Server-side public API
  domain-index.ts  Client-safe public API (pure domain only)

apps/web/src/
  app/             Layout, page (server component), server actions
  server/          Composition root, dashboard read model, write use cases
  components/      Presentational + two client components (apply link, filters)
```

### Two entry points, on purpose

`@job-queue/core` exports adapters that import `node:fs`. Importing it from a React **client** component drags the filesystem layer into the browser bundle — and the Next build fails, correctly.

So the package has a second entry point, `@job-queue/core/domain`, exporting only pure domain code and type-only port contracts. Client components import from there and share the same vocabulary as the server without duplicating a single enum.

The domain layer's purity is not a claim in a comment, it is an executable test:

```bash
npm test --workspace @job-queue/core   # tests/architecture/purity.test.ts
```

It walks the real import graph from `domain-index.ts` and fails on any node builtin, adapter, or third-party import.

## CLI options

| Flag | Default | Meaning |
|------|---------|---------|
| `--source=LIST` | `fixture` | Comma-separated supported source ids. Shortcuts: `boards` (configured company ATS providers) and `all` (every supported real source). `fixture` is never in a shortcut and may not share a run with a real source |
| `--limit=N` | *off* | Truncate the list to N rows. **Off by default** — every offer that passed both filters is shown. Opt-in only, for keeping a huge exploratory run readable. |
| `--explain=N` | `3` | How many entries get a full score breakdown |
| `--concurrency=N` | `4` | Simultaneous company-board requests |
| `--timeout=MS` | `15000` | Per-request timeout for company boards |
| `--out=PATH` | `output/queue.json` | Where to write the queue |
| `--fixture=PATH` | `data/sample-jobs.json` | Sample data file |
| `--applications=PATH` | `data/applications.json` | Application log |
| `--no-check-links` | *off* | Do **not** check whether the postings still exist. Checking is **on by default** for every source. One `HEAD` per unique apply URL, bounded and TTL-cached, so a repeat run is nearly free. A posting is **removed only on HTTP 404 or 410**; 403, 401, 429, every 3xx, every 5xx, timeouts, connection resets and DNS failures all **keep** it and mark it unverified. A run with no network removes nothing. |
| `--check-links` | — | Accepted, now a no-op: this is the default |
| `--liveness-cache=PATH` | `data/.link-liveness.json` | Liveness verdicts, and the evidence for every posting the pipeline removed |
| `--help` | — | Usage |

### Why removal is so narrow

A dead link the candidate clicks past costs five seconds. A real vacancy
silently deleted is invisible and unrecoverable — it does not appear, it does
not warn, and nothing anywhere would tell him it was ever found. So the burden
of proof sits entirely on the deletion, and only two status codes carry it.

This is not caution for its own sake. Two of the six unresolved shortener links
in the September queue were live junior roles at **CaixaBank Tech**. Their real
destination (`caixabanktech.com/es/job/junior-software-engineer-full-stack/`)
answers Node's `fetch` with `read ECONNRESET` — bot protection — while serving a
browser normally. A checker that deleted on "the server was unfriendly" would
have destroyed two opportunities the candidate is qualified for, and left no
trace. They are pinned as a named regression in
`tests/domain/link-liveness.test.ts` and `tests/app/queue-liveness.test.ts`.

Diagnostics go to stderr, the table goes to stdout, so `npm run start:offline > today.txt` keeps the table clean.

## Sample data never shares a run with real vacancies

`data/sample-jobs.json` is a committed demo catalogue. Its employers do not
exist and its links point at `example-board.test`, a domain reserved by RFC 2606
that resolves nowhere. That is the right design for a demo and a disaster the
moment one of its rows lands next to a real vacancy with an apply button on it.

It did. `--source=all` used to expand to *every selectable source*, fixture
included, so the documented command produced:

```
Contributed: fixture 105, greenhouse 64, lever 14, ashby 29

  #1  Trainee Software Developer   Kubo Labs   Madrid   85.8
      link: https://example-board.test/offers/fx-010
```

Two invented postings at positions #1 and #3 of a real queue. Three rules now:

1. **`all` means every real source.** The catalogue has to be asked for by name.
2. **Sample and real sources may not share a run.** `--source=all,fixture` and
   `--source=boards,fixture` are refused *at parse time*, before a single
   request, with an error naming the flag that does what you probably wanted.

   This is a refusal rather than a warning on purpose. A mixed queue is not one
   list with a caveat — it is a list where every row has to be re-checked for
   provenance before you act on it, because the table interleaves them by
   recency and the two look identical. There is also no use case: the fixture
   exists for an offline demo and for tests, and neither gets better with real
   vacancies stirred in. A refusal is cheaper than a banner, because a banner
   above a list of offers is the first thing a person stops reading on day three.

3. **Wherever sample data does surface, it says so.** `--source=fixture` is
   still legal, the web app still falls back to the catalogue, and an
   `output/queue.json` from an older build may still contain it — so the answer
   is read from the posting's own `sources[]` rather than from this run's flags:

   - the CLI prints a `SAMPLE DATA IN THIS QUEUE — n of m offers below are NOT
     REAL` banner **and** marks every affected row `[SAMPLE]`, because the table
     is longer than a screen and the banner scrolls away;
   - the web app shows the amber notice **whenever sample postings are present**,
     not only in the offline fallback, and badges each card `Ejemplo` with an
     amber rail.

## The pipeline audits its own links

Every run checks the queue it just built against the provenance rules in
`packages/core/src/domain/link-provenance.ts`, before writing it:

```
LINK AUDIT: 10 of 10 apply link(s) are not usable posting addresses.

  [placeholder-host] "Trainee Software Developer"
      href:   https://example-board.test/offers/fx-010
      reason: "example-board.test" does not host real postings
```

Nothing is repaired. A link the pipeline cannot vouch for is *reported*, never
replaced with a guess — that is how thirteen dead apply buttons shipped once.

No request is made: provenance is read from the address, which is where the
defect lives. Those rules were previously test-only code inside the E2E suite,
which is why they were green for the entire life of the `example-board.test`
defect — that suite only ever inspected queues it seeded itself. They are
production code now, shared by three callers: this CLI audit, the browser suite,
and `packages/core/tests/app/pipeline-link-provenance.test.ts`, which runs them
over a queue the real pipeline actually built.

## Failure behaviour

A dead source degrades the run; it never aborts it.

| Failure | Behaviour |
|---------|-----------|
| A single offer is malformed | That offer is skipped and logged; the page still yields the rest |
| **One company board 404s** | Absorbed. Logged, listed as a `degradedTargets` entry on the source report, and the other boards' postings are kept. It does **not** mark the run degraded |
| **Every board of one provider fails** | That provider is reported as `failed`; the other providers continue |
| A board hangs | Aborted after `--timeout` and treated as that board failing |
| Application log unreadable | Warned; every job renders as not-applied rather than blanking the page |

### Why one dead board is not a "degraded run"

The degraded-write guard was designed when a source was one request and a failure was rare and alarming.
With ~28 company boards, something 404s or times out on an ordinary day. If that counted as a failed
source query, the queue would print **"Degraded run"** every single morning — and a warning printed every
morning is a warning nobody reads on the morning it finally matters.

So the two facts are kept apart:

| Fact | Where it shows | Weight |
|------|----------------|--------|
| A **source query** failed | `status: 'failed'`, run health, can refuse a write | Loud, rare |
| A **company board** failed | `degradedTargets` on an otherwise `ok` report, a note in the summary | Quiet, common |

A provider only reports `failed` when it lost **every** one of its boards — the one case where "we found
nothing" is a statement about the network rather than about the job market, which is exactly what the
write guard needs in order to protect real postings.
| `output/queue.json` corrupt or from an older format | Web UI warns and falls back to the offline catalogue |
| Application log **corrupt on write** | Refuses to overwrite. Losing your real application history is worse than a loud error. |

### The queue is never overwritten by a run that learned nothing

Same asymmetry as the application log, applied to `output/queue.json`. The rule is one
sentence:

> **An empty result may only replace a non-empty queue when every source query succeeded.**

"Nothing came back" is trustworthy evidence about the job market only when every source
was asked *and* every source answered. The moment one query fails, an empty result is a
statement about the network instead — and that must not be written over real postings.

| Run | Existing queue | Result | Exit |
|-----|----------------|--------|------|
| Every query failed | has postings | **Not written.** Prior data untouched | `2` |
| Every query failed | absent or empty | Written — nothing to protect | `1` |
| Some failed, **0 postings** | has postings | **Not written.** Prior data untouched | `2` |
| Some failed, some postings | any | Written, with a loud `Degraded run` warning | `0` |
| All queries OK, 0 postings | any | Written — a real empty market is a real fact | `0` |
| Queue file unreadable | — | Treated as "holds data": protected, not assumed empty | `2` |

Exit `2` means *your data is intact and the API is not*, which is a different problem from
exit `1`. A partially degraded run that still produced postings is written on purpose:
refusing there would let one permanently flaky query freeze the queue forever.

## Restoring the queue

**`npm run seed:queue` refuses to run, and exits non-zero.** This is the fix for a real
defect, not an outage.

It used to rewrite `output/queue.json` from the 25 postings recorded in
fixture are real. **The URLs were not** — the fixture never captured them, so it built one
per posting out of the job *title*:

```
```

All 13 seeded apply buttons were dead links. A seeded queue is indistinguishable from a real
one on screen — same titles, same chips, same prominent Apply button — and the one field
that was wrong is the only field you act on, failing silently as "the offer expired".

So the trade is: an empty screen that explains itself, versus a full screen that lies. The
empty screen wins. Run a real source instead:

```bash
npm start -- --source=boards     # Greenhouse + Lever + Ashby. No API key, no quota.
```

The fixture is still used: it is the regression corpus for the software-relevance gate,
which does not read URLs. It simply can never again be a source of postings a human sees.

### The rule this enforces

> A job's URL is the source payload's own URL field, or the job does not exist.

It is enforced in the **domain**, in `createJob`, not per adapter — every path into the
system mints its jobs through that one function, so it is the single place the invariant
cannot be forgotten. A draft with a missing, relative or non-`http(s)` URL throws; adapters
catch that, skip the posting and log it. Nothing is ever defaulted or reconstructed.

## Development

```bash
npm run typecheck      # all three workspaces, strict, no any
npm test               # unit + integration (core and web)
npm run test:e2e       # browser tests against the real running app
npm run build          # core (tsc) then the Next.js app
npm run test:coverage --workspace @job-queue/core
```

The web app consumes `packages/core/dist`, so **core must be built before `next build` or `next dev`**. `npm run build` and `npm run dev` both do this for you.

## End-to-end tests

```bash
npm run test:e2e
```

That single command builds core, builds the Next app, starts the production server on port 3178, runs 29 browser tests against it, and shuts it down. No manually-started server, no manual seeding. First run only, install the browser:

```bash
npx playwright install chromium
```

To run a subset, work from the `e2e` workspace directly (npm eats the flags otherwise):

```bash
cd e2e && npx playwright test --grep "link integrity"
cd e2e && npx playwright test --ui
```

### What this suite guarantees that the 631 unit tests do not

This suite exists because of a specific, shipped, humiliating defect: **every apply button in the UI pointed at a fabricated URL and returned HTTP 403.** The address was built by pasting the job title into a path:

```
```

626 tests were green while that was live. Not one of them was wrong — and not one of them ever rendered the page, looked at a link and clicked it. They verified internals. The user clicked the buttons and found nothing.

Note what the bad URL is *not*: not empty, not relative, not a placeholder, not malformed. It is a well-formed absolute `https:` URL on a real external host. `z.string().url()` accepts it. TypeScript accepts it. `expect(href).toBeTruthy()` accepts it. The defect was **provenance** — the URL was invented from a field the pipeline happened to have, instead of taken from the source payload — and provenance is not a property a schema can see.

So the suite is optimised for one question: *would this have caught the dead-link bug?* Concretely, it checks the things that only exist once a browser has rendered the page:

| Guarantee | Why a unit test cannot give it |
|-----------|-------------------------------|
| **Every apply link in the DOM is a usable external address** | Unit tests assert on data structures. This walks the rendered `<article>` elements and reads the `href` the user would actually click, paired with the title on the same card. |
| **No apply link is derived from the job title** | The regression rule. Fires when the job title appears in the URL *and* the URL carries no source identifier — i.e. the address **is** the title, which is only true when something synthesised it. URLs that contain a title slug next to a real board id (`/jobs/4471203-junior-frontend`) pass, because they are addressable. |
| **No apply link resolves back into this app** | Computed the way the browser computes it, `new URL(href, origin)`. A relative href looks harmless in a snapshot and silently lands the user on our own page. |
| **A click records exactly one application — twice clicked, still one** | Idempotency is proven at the repository by unit tests. This proves it through a client component, a `useTransition`, a server action, `revalidatePath`, a re-render and a JSON file. Any of those links can break while the function stays correct. |
| **The applied state survives a reload, and is legible in greyscale** | WCAG 1.4.1. Asserts the label, the icon *and* the colour — the three redundant signals the component promises. |
| **An outcome set in the form is still there after a reload** | A form that updates the screen but not the disk is indistinguishable from a correct one until tomorrow. |
| **Filter counts stay truthful** | A filtered list whose headline still claims the unfiltered total is the same class of defect as a dead button: the interface stating something it cannot back up. |
| **Empty ≠ degraded** | "We asked and the market had nothing" and "we could not ask" must render different Spanish. Each assertion also requires the *other* message to be absent, so the two cannot be swapped silently. |
| **The apply control is reachable by Tab and fires on Enter, with a visible focus ring** | Walks the real tab order rather than calling `.focus()`. A product whose one button needs a pointer is unusable for a chunk of the people it serves. |
| **A normal session logs no console errors** | Nothing below the UI can observe this. |
| **The Spanish copy is the copy that reaches the screen** | The unit test over `es.ts` proves the strings exist. A component hard-coding `"Apply"` next to an unused `ES.apply.action` passes that test and fails the user. |

### State isolation: the suite cannot touch your data

The app writes to `data/applications.json` — your actual job-hunting history — and reads `output/queue.json`, your last real pipeline run. A browser test that clicks "Aplicar" performs a **real** write. A test suite that eats your application history would be a worse bug than the one it was written to catch.

So the suite never runs against those paths. `packages/core/src/config/paths.ts` exposes two overrides:

| Variable | Overrides |
|----------|-----------|
| `JOB_QUEUE_QUEUE_PATH` | `output/queue.json` |
| `JOB_QUEUE_APPLICATIONS_PATH` | `data/applications.json` |

`playwright.config.ts` exports both into the server process, pointing at `e2e/.tmp/` (gitignored, wiped before each run). Three layers make that a guarantee rather than an intention:

1. `assertIsolated()` aborts in global setup, before a browser starts, if either override is missing or points outside the scratch tree.
2. Global setup fingerprints both real files with SHA-256 and prints the hashes into the run log.
3. `zz-real-user-data.spec.ts` runs **last** (the `zz-` prefix is load-bearing — Playwright orders spec files by path) and asserts both files are byte-identical to that baseline. It also asserts a write *did* land in the scratch log, because "the real file did not change" is equally true of a suite that never wrote anything at all.

Verified on the run that shipped this suite: both files identical, same size, same mtime, before and after.

### Design choices worth knowing

- **A separate `e2e` workspace**, not tests inside `apps/web`. The suite builds and starts *both* other workspaces, so it is a workspace-level concern; keeping it separate also stops Playwright's globals and its 300 MB browser dependency leaking into the app's own package and typecheck.
- **`workers: 1`, `fullyParallel: false`.** The system under test is one server process whose state is two files on disk. Parallel workers would seed each other's queue mid-render. This is a handful of high-value journeys, not a matrix — the whole suite runs in ~30 s including the build.
- **`retries: 0`.** A retry on a suite this small turns a real intermittent defect into a green tick, which is the exact class of blindness that let thirteen dead buttons ship.
- **`next start`, not `next dev`.** Dev-mode React logging and on-demand compilation would make the console-error assertion meaningless.
- **Fixtures are literal JSON**, not pipeline output. The pipeline has 590 tests of its own; a browser suite that depended on it would go red for reasons that have nothing to do with the browser.

### What this suite still would not catch

Stated plainly, because a test suite you trust too much is worse than one you distrust:

- **A URL that is well-formed, has a real id, and is still dead.** Nothing here makes an HTTP request — deliberately, since that would be exactly the third-party board traffic this project refuses to generate. A posting that 404s because it was filled last week looks identical to a live one.
- **A URL taken from the right field of the wrong posting.** Provenance is checked structurally, not against the source payload.
- **Anything above the queue file.** The suite starts from a seeded `queue.json`. A scoring, filtering, dedupe or source-adapter defect that produces a *plausible* queue passes every test here.
- **Rendering defects.** No visual regression baseline. Text that is white-on-white, a card pushed off-screen, or a broken mobile layout all pass.
- **Real accessibility.** Keyboard reachability and focus visibility are checked; contrast ratios, screen-reader output and ARIA correctness are not. This is a smoke test, not an audit.
- **Cross-browser and cross-device.** Chromium at one desktop viewport only.
- **Concurrency across processes.** The application log's write lock is per-process. Two servers writing at once is out of scope here, as it is in the repository itself.

## Deliberate seams for the next slice

These are extension points, not missing features. This slice does not build them.

| Seam | Where | What plugs in |
|------|-------|---------------|
| More job boards | `JobSource` in `ports/job-source.ts` | InfoJobs, Tecnoempleo, RemoteOK — add an adapter, register it in the CLI. No domain change. |
| More company-board ATSs | `BoardProvider` in `adapters/boards/board-job-source.ts` | Workable, SmartRecruiters, Recruitee — supply a URL builder and a payload parser; fan-out, concurrency, timeouts, location filtering and failure isolation are already shared. |
| CV / cover-letter tailoring | `cvVariant` on every queue entry | The winning lane is already computed and persisted for every job |
| SQLite instead of a JSON file | `ApplicationRepository` in `ports/application-repository.ts` | One new adapter. Idempotency is already part of the port contract, so no caller changes. |
| Empirical weight retuning | `Application.scoreAtApply` + `outcome` | The labelled dataset this layer exists to produce. Nothing consumes it yet. |
| Multi-user / auth | The web app has none | Single-user local tool today. Every read is unauthenticated. |
| Re-tuning the ranking by hand | `config/scoring-config.ts` | Every weight and keyword, in one typed object |

## Cross-source dedupe: why it is deliberately conservative

Once the same vacancy can arrive from a search API **and** from the company's own board, it arrives with a
different id, a different URL (one is a search API redirect) and often a different title — `Frontend Engineer`
on Greenhouse, `Frontend Engineer (m/f/d)` on a search API. The original three dedupe keys all miss it.

The governing rule, which decides every design choice here:

> **A false merge is worse than a missed duplicate.**

A missed duplicate costs ten seconds of scrolling. A false merge **deletes a real, applyable vacancy from
the queue** and leaves nothing behind saying it existed.

That rules out the obvious approach. No edit distance, no token-overlap ratio, no similarity threshold —
every one of those merges `Backend Engineer` into `Backend Engineering Manager` at some tuning, because the
difference between decoration and seniority is semantic, not lexical.

**The heuristic actually used** (`domain/identity.ts`): strip only the decoration boards are *known* to add,
then require an **exact** match on what remains, anchored on the employer.

| Removed | Kept |
|---------|------|
| Gender markers: `(m/f/d)`, `(M/W/D)`, `Desarrollador/a` | Seniority: `Senior`, `Junior`, `Lead` |
| Legal forms: `S.L.`, `S.A.`, `Inc.`, `GmbH`, `Ltd` | Level markers: `II`, `III` |
| Location/remote tails: `- Madrid`, `\| Remote`, `(Madrid)` | Stack qualifiers: `(React)`, `(Java)` |

Two extra safeguards:

- **No employer, no merge.** With a blank company the key returns `null` rather than degrading into
  `::junior developer::madrid`, which would collapse every anonymous posting in the queue into one. a search API
  reaches that state on its own — its schema defaults `company` to the empty string, which is how
  recruiter-posted ads routinely arrive.
- **A parenthetical is dropped only when *every* word inside it is known noise.** `(Madrid)` goes,
  `(German Market)` stays.

So `Frontend Engineer (m/f/d)` at `Cabify S.L.` in `Madrid, Comunidad de Madrid, Spain` merges with
`Frontend Engineer` at `Cabify` in `Madrid`. `Frontend Engineer` and `Frontend Engineer II` at the same
company do **not**. Anything this misses stays in the queue as a visible duplicate — the cheap failure.

## Known limitations

- **`languageFit` is a heuristic.** It counts Spanish vs. English stopwords rather than doing real language detection. A Spanish ad that quotes a lot of English can be misread.
- **The seniority body-penalty has false positives.** `"trabajarás junto a un equipo senior"` costs a junior posting a few points. The penalty is deliberately weaker for body matches than for title matches, but it is not zero.
- **Cross-source dedupe is exact-after-canonicalization, so it misses reworded reposts on purpose.** See below.
- **Company boards contribute few *junior engineering* roles.** A real 3-provider run over 28 boards returned 105 postings → 103 unique → 51 passed the software gate → **14** passed the junior filter. The rest were sales, marketing, finance and operations, or explicitly senior/principal/staff engineering roles. Company boards are the whole company, and the companies on this list hire mostly seniors.
- **Sample ad copy is in Spanish.** That is the language of the market this parses; the code, comments and interface are English.
- **Apply-tracking needs JavaScript.** The Apply anchor always opens the posting, but the click is only *recorded* when JS is enabled. Setting an outcome works without JS — it is a plain form post.
- **The application log is single-process safe, not multi-process safe.** Writes are atomic and serialized within one Node process. Running the CLI and the web app at the same moment could still lose a write; run only one at a time. Acceptable for a single-user local tool; it is the reason the repository interface exists. The same limit applies to the queue, liveness and link caches.
- **Response rates over small samples are noise.** The panel says so explicitly below 10 applications, and always shows the denominator next to the percentage.
- **`next` pins an internal `postcss@8.4.31`** with known advisories. They concern build-time processing of attacker-supplied CSS; all CSS here is authored in-repo. Fixing it requires Next 16 (a breaking upgrade), so it is accepted rather than forced.

