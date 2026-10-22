# The scheduled mail check (`npm run mail:check`)

One command checks Gmail **read-only** for replies about your applications and
turns the unambiguous ones into **pending proposals**. It is the same mail
pipeline the web app runs as an on-open catch-up — the command exists so the
check can also happen when nobody opens the app (use case CU1: daily at 08:00,
Spanish time). A proposal never changes an application by itself: you confirm
or dismiss it on `/seguimiento`.

## What a run does

- Reads recent Gmail messages (scope `gmail.readonly`, never deletes or sends).
- Matches replies against your open applications and stores a short snippet as
  a pending proposal in `data/mail-proposals.json` (git-ignored).
- Updates `data/.mail-run.json` (git-ignored) with the last success, attempt
  and error, so a missed run can be detected later.

Gates, in order, shared with the web app:

1. **Not configured** — without the Google credentials mail is simply off.
2. **Corrupt state** — `data/.mail-run.json` holds the date of the last
   successful check, so a unreadable file stops the run and is **never reset
   automatically**; you fix or remove it by hand.
3. **Not due** — nothing runs when the last success is after the most recent
   08:00 in `Europe/Madrid`.
4. **Cooldown** — after a failed attempt, retries wait 30 minutes so a
   persistent failure does not hammer Gmail.
5. **Already running** — a second run while one is in flight does nothing.

`--force` bypasses only the last two gates (the manual path); it never bypasses
missing credentials or a corrupt state file.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | A run finished, or there was nothing to do (not due, cooldown, already running). |
| `1` | Something needs you: credentials missing, state file corrupt, Google token expired, Gmail unreachable, or an unexpected failure. |

The output names variable names (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`), local paths and commands to run — never a credential
value, never an underlying exception message. When the refresh token is
rejected (it expires roughly every 7 days while the Google project is in
testing), run the consent flow again to get a new one.

## Trying it

```bash
npm run mail:check -- --force
```

Credentials are local and git-ignored, in two places:

- The **web app** reads `GOOGLE_*` from `data/dev-env.json`
  (loaded by `scripts/run-web.mjs`).
- This **CLI** reads `GOOGLE_*` from the root `.env`
  (`packages/core/src/cli/mail-check.ts` calls `loadDotEnv`). Put
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` there, then run
  `npm run google:consent` once in a browser session: it writes the refresh
  token to `.env` and never prints it.

A run without `--force` before 08:00, or on a day the check already succeeded,
will simply report that nothing is due — that is correct, not a bug.

## Windows Task Scheduler recipe (you register the task, the repo never does)

Goal: a **daily** run at **08:00, Europe/Madrid**, even when the web app is
closed. Register it yourself in Task Scheduler (`taskschd.msc`) — nothing in
this repository creates, modifies or deletes a scheduled task.

1. **Create Task…** (not Basic Task), name it e.g. `job-queue-mail-check`.
2. **Triggers** → New → *Daily*, start **08:00**, enabled. Task Scheduler uses
   the local Windows clock, so have Windows itself set to the Madrid time zone
   (it is, on a Spanish machine) — the app's own catch-up logic independently
   decides what is *due* in `Europe/Madrid`.
3. **Actions** → New:
   - *Program/script*: the full path of `npm.cmd` (usually
     `C:\Program Files\nodejs\npm.cmd`; check with `where npm`).
   - *Arguments*: `run mail:check` (or use `cmd.exe` as the program with
     `/c npm run mail:check` as arguments).
   - *Start in*: `D:\Adrian\22. Proyectos\job-search-assistant` — required:
     npm workspace scripts resolve from there.
4. **General** → *"Run whether user is logged on or not"* caveat: the refresh
   token and the rest of the local configuration live in `.env` /
   `data/dev-env.json`, so the account the task runs as must be the one that
   owns those files in the project folder. Running it as a different account,
   or with a profile that cannot read them, makes the command exit `1` with
   "mail is not configured" — it will not fail silently into sending anything,
   because there are no credentials to send with.
5. Optional: **Settings** → run task as soon as possible after a missed start.

## If a scheduled run is missed

Nothing is lost. The web app's on-open catch-up performs the check the next
time you open the app, because `isMailRunDue` compares the stored last success
against the most recent 08:00 in `Europe/Madrid` — the run does not have to
happen at 08:00 exactly, only once per day.
