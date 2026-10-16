/**
 * What a fetch run is doing, and what the last one concluded.
 *
 * Fully serializable - no `Date`, no class instances - because this crosses two
 * boundaries: a JSON file on disk, and a server action's return value on its way
 * to the browser.
 *
 * The state lives on DISK rather than in a module variable, for two reasons that
 * are both about not lying to the user:
 *
 *   - a second browser tab talks to the same server but a fresh React tree, and
 *     it has to be able to see that a run is already going;
 *   - a server restart must not leave the UI insisting a run is still in flight
 *     when the process that owned it is gone.
 */

/** The numbers a finished run reports, as figures rather than a paragraph. */
export interface FetchRunSummary {
  /**
   * Whether the queue file was actually replaced.
   *
   * `refused` is a SUCCESSFUL run with a protective outcome, not a failure: the
   * degraded-write guard in `persist-queue.ts` declined to overwrite real
   * postings with an empty result from a broken run. Flattening the two would
   * throw away the entire value of that guard.
   */
  readonly outcome: 'written' | 'refused';
  readonly totalFetched: number;
  readonly totalUnique: number;
  readonly duplicatesRemoved: number;
  /** Removed by filter A. */
  readonly excludedNotSoftware: number;
  /** Removed by filter B on experience or seniority (includes legacy `junior_eligibility`). */
  readonly excludedNotJunior: number;
  /** Removed by the hard locality rule (`location_incompatible`). */
  readonly excludedByLocation: number;
  /** Of `excludedNotJunior`: explicit requirement above 2 years. */
  readonly excludedByExperience: number;
  /** Of `excludedNotJunior`: senior/lead/manager role. */
  readonly excludedBySeniority: number;
  /** Removed because the address answered HTTP 404 or 410. */
  readonly removedAsGone: number;
  /** Offers the human can actually see, net of the dead-link removals. */
  readonly offersAvailable: number;
  readonly failedSources: readonly {
    readonly sourceId: string;
    readonly query: string;
    readonly error: string;
  }[];
  /** The write policy's own warnings, carried through rather than restated. */
  readonly warnings: readonly string[];
  /** Why the write was refused. Null when it was not. */
  readonly refusalReason: string | null;
  /** How many postings the refusal kept alive. Null when unknown or not refused. */
  readonly preservedJobCount: number | null;
}

export type FetchRunState =
  /** No run has ever been started, or the record was lost. */
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly runId: string; readonly startedAt: string }
  | {
      readonly status: 'finished';
      readonly runId: string;
      readonly startedAt: string;
      readonly finishedAt: string;
      readonly summary: FetchRunSummary;
    }
  /** The pipeline threw. Distinct from a `finished` run whose write was refused. */
  | {
      readonly status: 'failed';
      readonly runId: string;
      readonly startedAt: string;
      readonly finishedAt: string;
      readonly error: string;
    };

export interface RunClaim {
  readonly runId: string;
  readonly startedAt: Date;
}

export type ClaimResult =
  | {
      readonly ok: true;
      /**
       * True when this claim recovered a lock whose owner never settled it.
       *
       * Reported rather than silent: "we assumed the previous run died" is a
       * statement the human is entitled to see, because the alternative reading
       * of the same screen is that their earlier run finished normally.
       */
      readonly tookOverStaleRun: boolean;
    }
  | { readonly ok: false; readonly state: FetchRunState };

/**
 * Driven port for run state and the single-flight lock.
 *
 * `claim` is the whole contract. It must be ATOMIC: two callers racing it may
 * not both receive `ok: true`. A read-then-write implementation does not
 * satisfy this port.
 */
export interface RunStateStore {
  read(): Promise<FetchRunState>;

  /**
   * Takes the lock, or reports who holds it.
   *
   * `staleAfterMs` bounds how long a lock may be held without being settled
   * before a new claim may take it over. A feature that locks itself forever on
   * one crashed run is worse than one with no lock at all.
   */
  claim(claim: RunClaim, staleAfterMs: number): Promise<ClaimResult>;

  /**
   * Publishes the final state and releases the lock.
   *
   * Returns false when this run no longer holds the lock - a zombie whose
   * takeover already happened must not clobber the live run's state.
   */
  settle(runId: string, state: FetchRunState): Promise<boolean>;
}
