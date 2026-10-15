# Funnel Tracking and Debt Review

## Goal
Measure the whole job-search funnel (not only post-application outcomes), attribute results to sources, and pay the persistence debt that these changes would otherwise multiply.

## Specs
- S1. Persistence debt is paid before new fields: the two JSON log repositories share one store (file read/validate, serialised writes, atomic write, missing-file handling); `cvVariant` in the schema is derived from the domain type; `emptyOutcomeTally` has no cast. Behavior is unchanged and legacy files still load.
- S2. An `Application` records the source ids of the vacancy at apply time, taken server-side from the queue entry (the client still sends only a `jobId`). Legacy applications without sources still load.
- S3. Stats report conversion per source (applied, responses, advances, rates), most-used first, alongside the per-CV-variant stats; the stats panel shows it with Spanish copy.
- S4. A `Dismissal` records an optional reason from a closed list; legacy dismissals still load; the dismiss UI offers the reasons without forcing one.
- S5. Stats expose the full funnel: surfaced (queue + dismissed + applied) -> applied -> responses -> advances -> interviews/offers, with rates safe for empty denominators; the stats panel shows it.
- S6. Docs (README/help text) describe the new tracking and the persistence format changes.
- Non-goals (deferred): "saved" stage, status history and follow-up reminders.

## Tasks
- [x] T1 (S1) Share JSON log store; derive enum; remove cast. Route: inline. Commit: 00a6d29. Evidence: typecheck clean; core 985 and web 84 pass unchanged (existing repo tests cover invalid JSON, schema refusal, idempotency); no casts left in stats tally.
- [x] T2 (S2) Source ids on Application. Route: inline, test-first. Commit: 136f521. Evidence: RED 3 expected failures, GREEN; typecheck clean; core 988, web 84 pass. Legacy log without sourceIds loads as [].
- [x] T3 (S3) Per-source stats and panel. Route: inline, test-first. Commit: cf4047d. Evidence: RED 1 expected failure, GREEN 9/9 focused; typecheck passed; core 989 and web 84 passed. Multi-source vacancies credit every source; legacy records use unknown.
- [ ] T4 (S4) Dismissal reason. Route: inline, test-first. Commit: pending
- [ ] T5 (S5, S6) Funnel stats, panel, docs. Route: inline, test-first. Commit: pending

## Log
- L1 (user, verbatim): "Hzlo como creas que es mas operativo y renemos que revisar la deuda"
- L2 (context): assessment proposed A source on application, B dismissal reason, C saved stage, D status history, E funnel view; user delegated the choice. A+B+E plus debt chosen; C and D deferred.
