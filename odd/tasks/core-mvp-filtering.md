# Core MVP Filtering

## Goal
Turn the current aggregation infrastructure into an operational MVP: only useful vacancies survive, every surviving vacancy explains its provenance, and unreliable sources are removed rather than tolerated.

## Specs
- S1. Remove Adzuna completely from runtime composition, CLI source selection/help, credentials/config, exports, documentation and tests. Exact user requirement: "tenemos que eliminar adzuna.. creo que solo da problemas".
- S2. Remove the JuniorJobs newsletter ingestion path and every offer loaded through `juniorjobs.short.gy`; remove dead newsletter CLI/config/adapter/docs/tests when no supported parser remains. Exact user requirement: "tambien hemos de quitar las ofertas que se cargan desde el enlace de juniorjob o alo asi".
- S3. Apply one hard location rule after ingestion to every source: keep Madrid/nearby, hybrid in Madrid, and remote work legally performable from Spain; exclude explicitly incompatible locations. Unknown location handling must be explicit and tested. Decision: "Madrid + remoto desde España (recomendado)".
- S4. Apply one hard experience rule after ingestion to every source: exclude explicit requirements of 3+ years; keep 0-2 years and postings that do not state years. Decision: "Máximo 2 años; desconocido entra (recomendado)".
- S5. Apply one hard seniority rule after ingestion to every source: exclude explicit senior, lead and manager roles; keep junior, entry, graduate, trainee, associate and postings with no explicit level. Decision: "Excluir senior/lead/manager (recomendado)".
- S6. Every queue entry and job card must show its actual source or sources using stable human labels; the UI must filter by source without losing multi-source vacancies. Exact user requirement: "saber de donde es la oferta si de infojobs, indeed, etc etc". Do not claim InfoJobs/Indeed support unless an actual authorized adapter/import path produced the vacancy.
- S7. Filtering must produce auditable exclusion reasons and source/run counts so the user can tell what was fetched, rejected and retained.
- S8. Update CLI help, README/source docs, tests and fixtures alongside behavior. Preserve manual application; do not add portal scraping or automatic application.

## Tasks
- [x] T1 (S1) Remove Adzuna end-to-end. Route: inline after bounded map. Commit: d7fb62c. Evidence: removed adapter, schema, credentials, category contract, source selection, composition factory, exports, help/docs and dedicated tests; `.env.example` has no Adzuna variables; no Adzuna refs remain outside the ODD log; typecheck passed; core 968 and web 85 tests passed.
- [x] T2 (S2) Remove JuniorJobs/newsletter ingestion end-to-end. Route: inline after bounded map. Included in the final combined commit; evidence: adapters/config/CLI/tests/docs removed, grep clean, typecheck and full suites passed.
- [x] T3 (S3-S5, S7) Build the unified hard eligibility filter and audit reasons. Route: test-first. Included in the final combined commit; evidence: locality/experience/seniority gates, stable audit codes, CLI/web counts, 932 core tests and web/core typechecks passed.
- [x] T4 (S6) Show and filter source provenance in the web UI. Route: test-first. Included in the final combined commit; evidence: source labels/fallback/count helpers, card display, source filter, 94 web tests and web typecheck passed.
- [ ] T5 (S8) Update docs/help, run full verification, and record remaining core debt. Route: inline + independent verification when available. Commit: pending

## Log
- L1 (user, verbatim): "Hay que revisar muchas cosas aun a nivel de core. Ademas tenemos que eliminar adzuna.. creo que solo da problemas, tambien hemos de quitar las ofertas que se cargan desde el enlace de juniorjob o alo asi. Ademas cuando tengamos la lista de empleos hemos de filtrar tanto por localidad, experiencia requerida o por seniority, saber de donde es la oferta si de infojobs, indeed, etc etc.. ahora mismo no tenemos casi ni un MVP"
- L2 (decision): Locality = "Madrid + remoto desde España (recomendado)".
- L3 (decision): Experience = "Máximo 2 años; desconocido entra (recomendado)".
- L4 (decision): Seniority = "Excluir senior/lead/manager (recomendado)".
- L5 (implementation): T2 removed JuniorJobs/newsletter ingestion; local untracked data/newsletters files were excluded from commits to preserve user data.
- L6 (implementation): T3 added a post-ingestion hard eligibility gate for locality, experience and seniority with stable exclusion codes and run/UI counts; unknown evidence remains eligible.
- L7 (implementation): T4 exposes stable source labels on every web card and filters the queue by source while retaining multi-source vacancies.
- L8 (verification): Core and web typechecks passed; focused T3/T4 checks passed; core suite passed with 932 tests and web suite with 94 tests. Final workspace-wide verification remains T5 work.
