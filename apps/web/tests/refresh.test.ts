import { describe, expect, it } from 'vitest';
import type { MailCheckResult } from '@job-queue/core';
import { startRefresh, type FetchStartOutcome, type RefreshDeps } from '@/server/use-cases';

/**
 * The composite behind the ONE "Actualizar" button (S12): a mail review FIRST,
 * then the offer fetch, in that order, reporting both.
 *
 * The guarantees that matter here are about what happens when one half is
 * broken or busy: a mail failure must not stop the offer search, a fetch that
 * is already running must be REPORTED (the single-flight lock lives in
 * `startFetch`, not here) and the pending-proposal count is information, never
 * a failure of the whole refresh.
 */

function deferredFetchOutcome(): FetchStartOutcome {
  return {
    ok: true,
    message: 'started',
    completion: Promise.resolve(),
  };
}

function deps(overrides: Partial<RefreshDeps> = {}): RefreshDeps & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    runMailReview: async () => {
      calls.push('mail');
      return { outcome: { status: 'ok', messages: [] }, proposed: 2 } satisfies MailCheckResult;
    },
    countPendingProposals: async () => {
      calls.push('pending');
      return 2;
    },
    startRun: async () => {
      calls.push('fetch');
      return deferredFetchOutcome();
    },
    ...overrides,
  };
}

describe('startRefresh', () => {
  it('counts the pending proposals BEFORE the review, then reviews, then starts the fetch', async () => {
    const testDeps = deps();
    await startRefresh(testDeps);
    expect(testDeps.calls).toEqual(['pending', 'mail', 'fetch']);
  });

  it('reports the older pending proposals, never the ones this run creates', async () => {
    // The review proposes 2; one older proposal was already waiting. The panel
    // words this number as "propuestas anteriores", so it must stay 1.
    const outcome = await startRefresh(
      deps({
        runMailReview: async () => ({ outcome: { status: 'ok', messages: [] }, proposed: 2 }),
        countPendingProposals: async () => 1,
      }),
    );
    expect(outcome.mail.proposed).toBe(2);
    expect(outcome.pendingProposals).toBe(1);
  });

  it('reports the mail outcome, the proposal count and the fetch answer', async () => {
    const outcome = await startRefresh(
      deps({
        runMailReview: async () => ({ outcome: { status: 'not_configured' }, proposed: 0 }),
        countPendingProposals: async () => 3,
        startRun: async () => ({ ...deferredFetchOutcome(), message: 'already' , ok: false }),
      }),
    );
    expect(outcome.mail).toEqual({ outcome: { status: 'not_configured' }, proposed: 0 });
    expect(outcome.pendingProposals).toBe(3);
    expect(outcome.fetch).toEqual({ ok: false, message: 'already' });
  });

  it('a broken mail review is reported as failed and the offer search still runs', async () => {
    const testDeps = deps({
      runMailReview: async () => {
        throw new Error('dependency exploded');
      },
    });
    const outcome = await startRefresh(testDeps);
    expect(outcome.mail.outcome).toEqual({ status: 'failed' });
    expect(outcome.mail.proposed).toBe(0);
    expect(testDeps.calls).toContain('fetch');
  });

  it('an unreadable pending-proposal count is null, never a thrown error', async () => {
    const outcome = await startRefresh(
      deps({
        countPendingProposals: async () => {
          throw new Error('proposals unreadable');
        },
      }),
    );
    expect(outcome.pendingProposals).toBeNull();
  });

  it('hands back the fetch completion so the action can hold the run reference', async () => {
    let finished = false;
    const outcome = await startRefresh(
      deps({
        startRun: async () => ({
          ok: true,
          message: 'started',
          completion: Promise.resolve().then(() => {
            finished = true;
          }),
        }),
      }),
    );
    await outcome.completion;
    expect(finished).toBe(true);
  });
});
