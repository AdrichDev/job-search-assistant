import type { Logger } from '../ports/logger.js';
import type { PipelineRunner } from '../ports/pipeline-runner.js';
import type { FetchRunState, RunStateStore } from '../ports/run-state-store.js';

/**
 * "The human pressed Buscar ofertas."
 *
 * Three properties, in order of how much they matter.
 *
 * ## 1. Single-flight, enforced in the SERVER
 *
 * Two clicks, or two tabs, or a click plus a leftover request, must never put
 * two pipelines on the same queue file. A disabled button does not achieve
 * that: it is a suggestion, it is absent in the second tab, and it is gone the
 * moment somebody reloads. The guarantee lives in `RunStateStore.claim`, which
 * is an exclusive-create lock, and everything here does is respect its verdict.
 *
 * ## 2. Non-blocking
 *
 * A real run is ~137 HTTP requests. Holding a request open for it would blow
 * every timeout between the browser and here, and would tie the run's survival
 * to the tab that started it. So the claim is awaited, the run is not, and the
 * pipeline is handed back as `completion` - which the server action drops on the
 * floor and the tests await. That is the whole of the "background job" machinery
 * this app needs; a queue with workers would be infrastructure for one user
 * pressing one button.
 *
 * ## 3. The lock is always released
 *
 * Every exit path settles. A pipeline that throws publishes `failed` and frees
 * the lock, and `completion` never rejects, so an unhandled rejection cannot
 * take the server down with it.
 */

/**
 * How long a lock may be held without being settled before another claim may
 * take it over.
 *
 * Fifteen minutes. A real run is bounded by its own per-request timeout and
 * concurrency and finishes in minutes, so this sits comfortably above a slow
 * run while being far short of "locked out for the day". The alternative -
 * no timeout - means one crashed process disables the feature until somebody
 * finds and deletes a dotfile, which is not a thing a user should have to know.
 */
export const DEFAULT_STALE_RUN_MS = 15 * 60 * 1000;

export interface StartFetchRunDeps {
  readonly store: RunStateStore;
  readonly runner: PipelineRunner;
  readonly now: () => Date;
  readonly newRunId: () => string;
  readonly logger: Logger;
  readonly staleAfterMs?: number;
}

export type StartFetchRunResult =
  | {
      readonly status: 'started';
      readonly runId: string;
      readonly startedAt: string;
      /** True when this run recovered a lock whose owner never settled it. */
      readonly tookOverStaleRun: boolean;
      /**
       * Resolves when the pipeline has finished and its state is published.
       *
       * NEVER rejects. Callers that do not care may ignore it entirely; the
       * server action does exactly that, which is what makes the request
       * non-blocking.
       */
      readonly completion: Promise<void>;
    }
  | {
      readonly status: 'already_running';
      readonly startedAt: string;
    };

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The best "when did it start" we can report about a lock somebody else holds. */
function startedAtOf(state: FetchRunState, fallback: string): string {
  return state.status === 'idle' ? fallback : state.startedAt;
}

export async function startFetchRun(deps: StartFetchRunDeps): Promise<StartFetchRunResult> {
  const startedAt = deps.now();
  const runId = deps.newRunId();
  const staleAfterMs = deps.staleAfterMs ?? DEFAULT_STALE_RUN_MS;

  const claim = await deps.store.claim({ runId, startedAt }, staleAfterMs);

  if (!claim.ok) {
    return {
      status: 'already_running',
      startedAt: startedAtOf(claim.state, startedAt.toISOString()),
    };
  }

  if (claim.tookOverStaleRun) {
    deps.logger.warn(
      'a previous fetch run never reported finishing and its lock had gone stale; ' +
        'taking it over. If that run is somehow still alive, two runs may now overlap.',
    );
  }

  const completion = (async (): Promise<void> => {
    try {
      const summary = await deps.runner.run();
      await deps.store.settle(runId, {
        status: 'finished',
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: deps.now().toISOString(),
        summary,
      });
    } catch (cause: unknown) {
      const error = describe(cause);
      deps.logger.error(`fetch run ${runId} failed: ${error}`);
      await deps.store
        .settle(runId, {
          status: 'failed',
          runId,
          startedAt: startedAt.toISOString(),
          finishedAt: deps.now().toISOString(),
          error,
        })
        // A store that cannot even record the failure must not turn a failed run
        // into a crashed server. The stale timeout is the backstop.
        .catch((settleFailure: unknown) => {
          deps.logger.error(
            `could not publish the failure of fetch run ${runId}: ${describe(settleFailure)}`,
          );
          return false;
        });
    }
  })();

  return {
    status: 'started',
    runId,
    startedAt: startedAt.toISOString(),
    tookOverStaleRun: claim.tookOverStaleRun,
    completion,
  };
}
