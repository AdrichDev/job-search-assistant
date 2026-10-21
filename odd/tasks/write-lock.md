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

S5 — A lock left behind by a dead process is **reported, never reclaimed**. The next acquisition fails
with a message naming the holder's pid and the lock file, and the operator deletes it. Automatic
reclaim is refused by design: judging a lock dead and deleting the path are two steps, no portable
compare-and-delete closes them, and two reclaimers can each delete the other's replacement.

S6 — A failed operation must release the lock. A thrown error inside the critical section may not
poison later writes in the same process or in another one.

S7 — In-process serialisation (`exclusive`) keeps its current semantics, including nested use
inside one process, which must not self-deadlock.

S8 — Single-process behaviour is unchanged: the existing suite stays green, no store gains a new
public method, and no user data is rewritten by this change.

## Tasks

| ID | Spec | Route | Commit |
|----|------|-------|--------|
| T1 | S1,S3,S4 | test-first RED: fixture writer process + a test that runs two processes against one store and loses an update | 6520495 |
| T2 | S2,S4,S5,S6 | implement `src/adapters/persistence/write-lock.ts` (exclusive create, pid+timestamp, bounded retry, stale recovery) | 6520495 |
| T3 | S2,S3,S7 | wire the lock into `createJsonLogStore` around `exclusive`, with in-process reentrancy | 6520495 |
| T4 | S5 | test: a stale lock from a dead pid is recovered | 6520495 |
| T5 | S4 | test: a live holder makes the second process fail after the bounded wait, writing nothing | 6520495 |
| T6 | S7,S8 | test: nested `exclusive` in one process does not deadlock | 6520495 |
| T7 | S8 | full verification: typecheck, core suite, web suite, e2e untouched by this change | 6520495 (e2e pending) |

## Log

L1 — User authorization (verbatim): `Perfecto, por que quieres comenzar?` then `a`, choosing option A:
same worktree as the UI work, commits by explicit path (`packages/core/**` and `odd/tasks/write-lock.md` only).

L2 — Evidence for the design: `json-log-store.ts` funnels every store through `writeAll` and already
serialises in-process with `exclusive`; `atomic-file.ts` makes each file write atomic but says nothing
about a second process. Repository call sites use one `exclusive` per store operation, and no use case
nests two stores inside one `exclusive`, which is why a per-directory lock is sufficient.

L3 — Ordering decision: this runs before T6 (portal parsers) because the write path is concentrated in
218 lines today; every later adapter or store would otherwise have to remember to take the lock.

L4 — Evidence (T1 RED, before the lock existed): two child processes × 15 cycles against one store left
**15 of 30** entries. An entire writer's output was lost, not just one update — the later writer kept
overwriting a base it had read before the other wrote. After the lock: 30/30, no duplicates, both
children exit 0. `write-lock.test.ts` adds six rules: clean release, release on throw, recovery from a
real dead pid, recovery by age, bounded failure naming the holder, and in-process re-entrancy.

L5 — Verification of record for 6520495: core `tsc --noEmit` clean, core suite **1475/1475 in 99 files**,
web suite **376/376 in 21 files**, web `tsc --noEmit` clean, and the full e2e suite **154/154 in 1m 42s** —
including `zz-real-user-data.spec.ts`, which asserts that the queue, applications, dismissals, history,
run state and CV registry stay byte-identical to their baseline. The lock therefore did not rewrite a
single byte of real user data.

L6 — Native assessment (RDD on, global) over `bffa205..HEAD`: `risk: medium`, `nativeRisk: medium`,
`reviewDue: false` with reason `under_budget`, writer profile `large` (runtime). Plan: writer
self-verification, no independent verifier, no structural-readback-only. No review was started, because
the contract starts one only when `reviewDue` is true or the user asks for it.

L7 — README updated in the same commit: the old limitation paragraph was replaced by the new guarantee
plus the residual limit (a lock covers a directory, not a transaction).

L8 — Native review `review-0da4d3da89e65514` (risk, resilience, reliability + refuter) raised two
candidate-caused CRITICALs, both real, both introduced by 6520495:

- `R3-recovery-race` — abandonment check and deletion were not coordinated, so two reclaimers could
  delete each other's replacement lock and a crash restart still admitted two writers.
- `R3-reentrancy` — the depth counter was process-global, so two INDEPENDENT operations in one
  directory both looked nested: they ran with one filesystem lock between them and the first to
  finish dropped it under the second.

Fix in `04bb82b` (189 diff lines against a declared plan of 190, budget 200): reclaiming takes a
recovery marker and re-verifies abandonment inside it; ownership is tracked per async context
(`AsyncLocalStorage`) and independent callers queue per directory. Both rules are pinned by tests
that FAIL against 6520495 — the independent-caller test observes a peak of 2 concurrent writers, and
the recovery test observes the lock being deleted while another reclaimer holds the marker.

Verification of record: core typecheck clean, core **1477/1477**, web **376/376**, web typecheck clean.

L9 — BLOCKED, authority preserved: the provider requested `targeted_validation_required` for the
correction. Two capture attempts were rejected with `capture-binding-rejected: collectBinding is
missing or stale for current STATUS` — first an object reconstruction, then the exact serialized
string from `collectBindings[0]`, after a fresh STATUS re-offered the same slot. No validator ran, so
there is no verdict, and the lineage stays in `correction_required`. Per the contract the attempt
stopped after the single reasoned relaunch; nothing was acknowledged, nothing was burned, and no
verdict was invented.

L10 — User authorized option A (verbatim: `a`) after the second refuter round: remove automatic lock
reclamation instead of adding another layer to it. Reason: the refuter found the same defect class
three times — check-then-delete on a pathname — first in the abandonment path, then in the recovery
marker. With `fs.open(..., 'wx')` there is atomic create but no portable compare-and-delete, and the
real primitive (`LockFileEx`/`flock`) needs a native dependency this project refuses by design.
Deleting the reclamation machinery removes the class instead of the instance: 170 diff lines against a
declared plan of 170, and the module shrinks by ~99 lines.

Behaviour now: a lock is never deleted by a process that did not create it. A provably gone owner fails
at once (fast, not after the full wait) with the file named and the manual step written out; a live
owner is waited for up to 5 s. Tests that pinned reclamation were replaced by one that asserts the dead
owner's lock survives and the message is actionable; core suite 1475/1475, typecheck clean.
