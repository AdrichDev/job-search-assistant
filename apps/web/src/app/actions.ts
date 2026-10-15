'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { consoleLogger, type FetchRunState } from '@job-queue/core';
import {
  applicationRepository,
  buildFallbackQueue,
  dismissalRepository,
  queueReader,
  runStateStore,
} from '@/server/container';
import { pipelineRunner } from '@/server/pipeline';
import {
  applyToJob,
  dismissOffer,
  readFetchState,
  restoreOffer,
  setOutcome,
  startFetch,
  type ActionOutcome,
  type FetchDeps,
  type WriteDeps,
} from '@/server/use-cases';

/**
 * Server actions: the only write surface exposed to the browser.
 *
 * Thin on purpose. All decisions live in `@/server/use-cases` and, below that,
 * in `@job-queue/core` - neither of which imports Next.js, so both are directly
 * testable without a running server.
 */

function deps(): WriteDeps {
  const now = new Date();
  return {
    applicationRepository: applicationRepository(),
    dismissalRepository: dismissalRepository(),
    // Falls back to the offline catalogue so an Apply click still resolves when
    // no CLI run has been persisted yet - the same queue the page is showing.
    loadQueue: async () => (await queueReader().read()) ?? (await buildFallbackQueue(now)),
    now: () => now,
  };
}

function fetchDeps(): FetchDeps {
  return {
    runStateStore: runStateStore(),
    pipelineRunner: pipelineRunner(),
    now: () => new Date(),
    newRunId: () => randomUUID(),
    logger: consoleLogger,
  };
}

export async function applyToJobAction(jobId: string): Promise<ActionOutcome> {
  const result = await applyToJob(jobId, deps());
  if (result.ok) {
    revalidatePath('/');
  }
  return result;
}

export async function setOutcomeAction(formData: FormData): Promise<void> {
  await setOutcome(formData.get('jobId'), formData.get('outcome'), formData.get('notes'), deps());
  revalidatePath('/');
}

export async function dismissOfferAction(jobId: string): Promise<ActionOutcome> {
  const result = await dismissOffer(jobId, deps());
  if (result.ok) {
    revalidatePath('/');
  }
  return result;
}

export async function restoreOfferAction(jobId: string): Promise<ActionOutcome> {
  const result = await restoreOffer(jobId, deps());
  if (result.ok) {
    revalidatePath('/');
  }
  return result;
}

/**
 * Background runs whose promises we deliberately do not await.
 *
 * Held in a module-level set for one reason: an unreferenced promise is a
 * candidate for garbage collection in some runtimes, and a collected run is a
 * lock that is never released. Cheap insurance for a set that holds at most one
 * entry - single-flight guarantees that.
 */
const inFlight = new Set<Promise<void>>();

/**
 * Starts an ingestion run and RETURNS IMMEDIATELY.
 *
 * The run is ~137 HTTP requests on a cold cache. Awaiting it here would blow
 * every timeout between the browser and this process and would tie the run's
 * survival to the tab that started it, so the completion promise is deliberately
 * dropped and the browser follows progress by polling `fetchStateAction`.
 *
 * Single-flight is NOT enforced by disabling the button. It is enforced in
 * `startFetchRun` by an exclusive-create lock, because a second tab has its own
 * button and a reloaded page has a fresh one.
 */
export async function startFetchAction(): Promise<ActionOutcome> {
  const { completion, ...outcome } = await startFetch(fetchDeps());

  inFlight.add(completion);
  /*
   * NO `revalidatePath` here, and that is a fix rather than an omission.
   *
   * This callback fires minutes later, long after the request that scheduled it
   * has been answered. Next refuses a revalidation raised outside a request or
   * action scope - it lands during whatever render happens to be in flight and
   * throws `Route / used "revalidatePath /" during render`, as an UNHANDLED
   * REJECTION in the server process. The E2E suite caught exactly that.
   *
   * The refresh belongs on the client instead, and is already there: the fetch
   * panel is polling, sees the run leave `running`, and calls `router.refresh()`
   * from a real client context. Same outcome, inside the lifecycle Next
   * actually supports.
   */
  void completion.finally(() => inFlight.delete(completion));

  return outcome;
}

/** What the run is doing right now. Polled by the fetch button while it runs. */
export async function fetchStateAction(): Promise<FetchRunState> {
  return readFetchState(fetchDeps());
}
