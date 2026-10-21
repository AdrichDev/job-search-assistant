# Cross-process write lock for the JSON stores

Closes the last known data-loss path: two OS processes (CLI and web) writing the same
JSON store at the same time. Today the guarantee is in-process only, and the README says so.

## Specs

S1 — `README.md:770` states the limit that this change must retire: the application log is
single-process safe, not multi-process safe; running the CLI and the web app at the same moment
could still lose a write; the same limit applies to the queue, liveness and link caches.

S2 — Lock granularity is **one lock per data directory**, not per file and not per process:
every store that shares a directory shares one lock. No new configuration key is introduced; the
lock file is derived from the target's directory so the e2e isolation that redirects every path
into `e2e/.tmp/` keeps working unchanged.

S3 — The lock must cover the whole read-modify-write cycle, not just the write. A write-only lock
would still let two processes read the same base and lose one update.

S4 — Contention is bounded: a waiter retries for a limited time and then fails with an actionable
message naming the lock file. It never writes anyway, and it never waits forever.

S5 — A lock left behind by a dead process must be recovered, not deadlock the app. Recovery is
based on the recorded pid being gone, or the lock being older than a fixed staleness horizon.

S6 — A failed operation must release the lock. A thrown error inside the critical section may not
poison later writes in the same process or in another one.

S7 — In-process serialisation (`exclusive`) keeps its current semantics, including nested use
inside one process, which must not self-deadlock.

S8 — Single-process behaviour is unchanged: the existing suite stays green, no store gains a new
public method, and no user data is rewritten by this change.

## Tasks

| ID | Spec | Route | Commit |
|----|------|-------|--------|
| T1 | S1,S3,S4 | test-first RED: fixture writer process + a test that runs two processes against one store and loses an update | this commit |
| T2 | S2,S4,S5,S6 | implement `src/adapters/persistence/write-lock.ts` (exclusive create, pid+timestamp, bounded retry, stale recovery) | this commit |
| T3 | S2,S3,S7 | wire the lock into `createJsonLogStore` around `exclusive`, with in-process reentrancy | this commit |
| T4 | S5 | test: a stale lock from a dead pid is recovered | this commit |
| T5 | S4 | test: a live holder makes the second process fail after the bounded wait, writing nothing | this commit |
| T6 | S7,S8 | test: nested `exclusive` in one process does not deadlock | this commit |
| T7 | S8 | full verification: typecheck, core suite, web suite, e2e untouched by this change | this commit |

## Log

L1 — User authorization (verbatim): `Perfecto, por que quieres comenzar?` then `a`, choosing option A:
same worktree as the UI work, commits by explicit path (`packages/core/**` and `odd/tasks/write-lock.md` only).

L2 — Evidence for the design: `json-log-store.ts` funnels every store through `writeAll` and already
serialises in-process with `exclusive`; `atomic-file.ts` makes each file write atomic but says nothing
about a second process. Repository call sites use one `exclusive` per store operation, and no use case
nests two stores inside one `exclusive`, which is why a per-directory lock is sufficient.

L3 — Ordering decision: this runs before T6 (portal parsers) because the write path is concentrated in
218 lines today; every later adapter or store would otherwise have to remember to take the lock.
