import { isMailRunDue } from '../domain/mail-schedule.js';
import type { GmailReader, MailMessage, MailUnavailableReason } from '../ports/gmail-reader.js';
import type { Logger } from '../ports/logger.js';
import type { MailRunState, MailRunStateStore } from '../ports/mail-run-state-store.js';

/**
 * The daily mail check: ask the reader for recent mail and remember how it went.
 *
 * Single-flight, in two layers:
 * - in this process, a module flag refuses a second concurrent call;
 * - across processes, a `runningSince` marker in the persisted state refuses a
 *   run while the previous attempt is newer than the stale window. A marker
 *   older than the window is taken over, so a crashed run never locks the
 *   feature out.
 *
 * The marker is ALWAYS cleared, including when the reader throws. Technical
 * detail of an unexpected failure goes to the logger only: state and result
 * carry the short code `unexpected`, never message text (it could hold a path
 * or part of a response).
 */

export const DEFAULT_MAIL_STALE_RUN_MS = 15 * 60 * 1000;
export const MAIL_OVERLAP_MS = 60 * 60 * 1000;
export const MAIL_FIRST_RUN_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const MAIL_MAX_RESULTS = 100;

export interface RunMailCheckDeps {
  readonly reader: GmailReader;
  readonly store: MailRunStateStore;
  readonly now: () => Date;
  readonly logger?: Logger;
}

export interface RunMailCheckOptions {
  /** Run even when the schedule says nothing is due. */
  readonly force?: boolean;
  readonly staleAfterMs?: number;
}

export type RunMailCheckResult =
  | { readonly status: 'ok'; readonly messages: readonly MailMessage[] }
  | { readonly status: 'auth_expired' }
  | { readonly status: 'unavailable'; readonly reason: MailUnavailableReason }
  | { readonly status: 'not_due' }
  | { readonly status: 'already_running' }
  | { readonly status: 'failed' };

let inFlight = false;

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function runMailCheck(
  deps: RunMailCheckDeps,
  options: RunMailCheckOptions = {},
): Promise<RunMailCheckResult> {
  if (inFlight) {
    return { status: 'already_running' };
  }
  inFlight = true;
  try {
    return await execute(deps, options);
  } finally {
    inFlight = false;
  }
}

async function execute(
  deps: RunMailCheckDeps,
  options: RunMailCheckOptions,
): Promise<RunMailCheckResult> {
  const { reader, store, now, logger } = deps;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_MAIL_STALE_RUN_MS;
  const startedAt = now();

  const before = await store.read();
  const previousSuccess = parseDate(before.lastSuccessAt);
  if (options.force !== true && !isMailRunDue(startedAt, previousSuccess)) {
    return { status: 'not_due' };
  }

  // Claim inside `update` so the check and the marker are one serialised step.
  let claimed = false;
  let sinceBase: Date | null = previousSuccess;
  await store.update((current) => {
    const marker = parseDate(current.runningSince);
    const lastAttempt = parseDate(current.lastAttemptAt) ?? marker;
    const fresh =
      marker !== null &&
      lastAttempt !== null &&
      startedAt.getTime() - lastAttempt.getTime() < staleAfterMs;
    if (fresh) {
      return current;
    }
    claimed = true;
    sinceBase = parseDate(current.lastSuccessAt);
    return {
      ...current,
      lastAttemptAt: startedAt.toISOString(),
      runningSince: startedAt.toISOString(),
    };
  });
  if (!claimed) {
    return { status: 'already_running' };
  }

  const since =
    sinceBase === null
      ? new Date(startedAt.getTime() - MAIL_FIRST_RUN_LOOKBACK_MS)
      : new Date((sinceBase as Date).getTime() - MAIL_OVERLAP_MS);

  const finish = (change: (current: MailRunState) => MailRunState) =>
    store.update((current) => ({ ...change(current), runningSince: null }));

  try {
    const result = await reader.fetchRecent({ since, maxResults: MAIL_MAX_RESULTS });
    const finishedAt = now().toISOString();

    if (result.status === 'ok') {
      await finish((current) => ({
        ...current,
        lastSuccessAt: finishedAt,
        lastError: null,
        authFailedAt: null,
      }));
      return { status: 'ok', messages: result.messages };
    }
    if (result.status === 'auth_expired') {
      await finish((current) => ({
        ...current,
        authFailedAt: finishedAt,
        lastError: 'auth_expired',
      }));
      return { status: 'auth_expired' };
    }
    await finish((current) => ({ ...current, lastError: result.reason }));
    return { status: 'unavailable', reason: result.reason };
  } catch (cause: unknown) {
    logger?.error(
      `Mail check failed unexpectedly: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
    );
    try {
      await finish((current) => ({ ...current, lastError: 'unexpected' }));
    } catch (storeCause: unknown) {
      logger?.error(
        `Mail check could not clear its running marker: ${
          storeCause instanceof Error ? storeCause.message : String(storeCause)
        }`,
      );
    }
    return { status: 'failed' };
  }
}
