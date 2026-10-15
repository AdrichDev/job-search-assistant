import type { FetchRunSummary } from './run-state-store.js';

/**
 * Driven port: performs one whole ingestion run and reports what it found.
 *
 * This is the seam that keeps pipeline orchestration out of React and out of
 * the fetch use case. `startFetchRun` owns the lock, the state transitions and
 * the timing; it knows nothing about HTTP, sources, or the write guard.
 *
 * It is also the boundary the E2E suite injects at. A browser test must not put
 * ~137 requests on real employers' servers, so the suite configures the runner
 * with the offline fixture source instead - the real pipeline, the real write
 * guard, the real state machine, and no network.
 *
 * Returning a summary rather than a `JobQueue` is deliberate: the caller stores
 * this verbatim in the run state, and a use case that had to re-derive counts
 * from a queue would be a second place where the numbers could disagree with
 * the ones the CLI prints.
 */
export interface PipelineRunner {
  run(): Promise<FetchRunSummary>;
}
