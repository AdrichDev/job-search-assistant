# Public Repository Hardening

## Goal
Prepare the project for its first safe public push without publishing personal data, generated runtime state, obsolete artifacts, or machine-local agent configuration.

## Constraints
- Keep the repository public.
- Do not automate or scrape LinkedIn or other third-party portals.
- Do not publish personal candidate data, application history, dismissals, credentials, or raw email alerts.
- Preserve the working application and its existing behavior unless a task explicitly changes it.
- Use work-unit commits. No pull request is required because the user is the sole collaborator.
- Rename the local directory only after verification and push, then reopen the workspace from the new path.

## Tasks

- [x] 1. Sanitize the public source boundary
  - Status: done. Independent `gentle-ai-verify` (anthropic/claude-opus-5-5) returned PASS on all 5 criteria, no blockers. Commit deliberately deferred: the repository has no commits yet, so the first commit must not contain the obsolete artifacts removed in Task 2 (`scripts/scrape-newsletter.ts`, `data/newsletter-2026-09-06.txt`). Task 1 and Task 2 will land as consecutive work-unit commits right after Task 2.
  - Note: ignored local files under `output/` still contain the real name; they are gitignored and must never be force-added.
  - Commit: 77b1d77 (shared with Task 2 because the repository had no prior commits; author is the GitHub noreply identity, set locally for this repository).
  - Ignore generated liveness state, raw newsletters, local agent configuration, and repository-local personal configuration.
  - Replace the embedded candidate identity with a safe committed example/default and a local override seam.
  - Replace personal names in tests with fictional fixtures.
  - Redact third-party contact PII from recorded API fixtures.
  - Verify `.env.example` contains placeholders only.
  - Evidence: candidate-profile RED observed (3 expected failures before loader); GREEN 3/3; `npm run typecheck` passed; `npm test` passed (core 980, web 84); exact-name/fixture/env structural scans passed; ignore rules verified with `git check-ignore`. Commit deferred until the repository cleanup boundary is safe.

- [x] 2. Remove obsolete and duplicate artifacts
  - Remove the duplicate root newsletter input and the superseded standalone newsletter scraping script if no production path depends on them.
  - Keep only the maintained newsletter adapter and synthetic test fixtures.
  - Remove or ignore generated link/liveness caches and obsolete generated reports.
  - Evidence: removed `scripts/scrape-newsletter.ts`, `data/newsletter-2026-09-06.txt` (identical duplicate of `data/newsletters/` copy) and the `scrape:newsletter` npm script; added synthetic `packages/core/tests/fixtures/juniorjobs-digest.synthetic.txt` (212 tokens anonymized) and repointed `juniorjobs-digest.test.ts` (20/20); `data/newsletters/*` ignored except README; README updated; typecheck OK; tests core 980, web 84. Commit: 77b1d77.

- [x] 3. Consolidate critical architecture debt
  - Eliminate avoidable duplication between CLI and web source composition where a bounded shared seam is safe.
  - Preserve the dependency direction `adapters -> app -> ports -> domain`.
  - Keep single-user local persistence explicit and document its multi-process limit.
  - Evidence: new `adapters/pipeline/source-composition.ts` holds the single source-factory table, link resolver and link checker builders; `cli/main.ts` and `queue-pipeline-runner.ts` now only inject logger/clock (CLI keeps its provenance hook). Added `pipeline-source-composition.test.ts` (5 tests). README documents the module and the multi-process limit. typecheck OK; core 985, web 84, e2e 62 passed. Dependency direction unchanged (architecture purity test passes).

- [x] 4. Define the safe source boundary
  - Document supported official APIs, employer ATS endpoints, email alerts, and manual import.
  - Explicitly reject unauthorized LinkedIn/Indeed scraping and automatic application.
  - Record the intended routes for Knowmad Mood, InfoJobs, Tecnoempleo, Indeed, Michael Page, LinkedIn, and Experteer.
  - Evidence: added `docs/sources.md` (allowed routes, rejected routes, per-portal intended route) and linked it from the README.

- [x] 5. Verify the first public candidate
  - Run typecheck, unit/integration tests, build, and E2E tests.
  - Re-run secret/PII scans over the exact staged candidate.
  - Review the exact first-commit file list.
  - Evidence: `npm run build` OK; typecheck OK; tests core 985 / web 84; e2e 62 passed; 252 tracked files, none from the ignored set (.env, output/, applications/dismissals, liveness cache, agent tooling, local profile, raw newsletters); content scan of tracked files found no personal email, keys or tokens; `.env.example` holds only empty placeholders; all commits authored with the GitHub noreply identity.

- [x] 6. Publish and rename the local workspace
  - Fast-forward the verified work onto `main` without a pull request.
  - Push `main` to `origin`.
  - Stop local processes, rename the directory to `job-search-assistant`, reopen the workspace, and verify the remote and application.
  - Evidence: branch renamed to `main` and pushed (HEAD 16c16c7); GitHub reports the repo PUBLIC, default branch main, 5 commits, 307 tree entries, 0 ignored-set paths. Dev server on port 3000 stopped. Rename done: workspace now at `job-search-assistant`; local main == origin/main (8515cb0). Stale node_modules workspace symlinks (old folder, caused a 500 on `@job-queue/core/domain`) fixed with `npm install --ignore-scripts`; `npm run dev` serves `/` with HTTP 200 and typecheck passes.

## Deferred Product Work
After this hardening feature closes, continue the existing assessment one item at a time: use cases and funnel, source acquisition, CV/ATS tailoring, manual versus automatic application, UI/UX, and external risks.