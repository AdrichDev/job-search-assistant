import { isMailCheckAllowed, isMailRunDue } from '../domain/mail-schedule.js';
import type { ApplicationRepository } from '../ports/application-repository.js';
import type { GmailReader } from '../ports/gmail-reader.js';
import type { Logger } from '../ports/logger.js';
import type { MailProposalRepository } from '../ports/mail-proposal-repository.js';
import type { MailRunState, MailRunStateStore } from '../ports/mail-run-state-store.js';
import { proposeFromMail } from './propose-from-mail.js';
import { runMailCheck, type RunMailCheckResult } from './run-mail-check.js';

/**
 * ONE mail check: fetch recent mail, turn clear replies into pending proposals.
 *
 * This is the whole ordered pipeline, and the order is the contract:
 * nothing is written when mail is not configured, a corrupt state file stops the
 * run instead of being reset, and an attempt is not repeated while the schedule
 * says nothing is due or while the retry cooldown still applies. `force` is the
 * manual path and bypasses only those last two gates.
 *
 * Both entry points call THIS function - the web app's on-open catch-up and the
 * scheduled `mail:check` CLI - so a fix to the sequence, such as restoring
 * `lastSuccessAt` when the proposals cannot be written, cannot land in one of
 * them and be forgotten in the other.
 */

export interface MailCheckDeps {
  /** `false` when the Google credentials are absent: the feature is simply off. */
  readonly configured: () => boolean;
  readonly reader: GmailReader;
  readonly store: MailRunStateStore;
  readonly proposals: MailProposalRepository;
  readonly applications: Pick<ApplicationRepository, 'list'>;
  readonly now: () => Date;
  readonly logger?: Logger;
}

/**
 * A `runMailCheck` result plus the three gates that belong to the caller rather
 * than to the reader: not configured, corrupt state, retry cooldown.
 */
export type MailCheckOutcome =
  | RunMailCheckResult
  | { readonly status: 'not_configured' }
  | { readonly status: 'state_corrupt' }
  | { readonly status: 'cooldown' };

export interface MailCheckResult {
  readonly outcome: MailCheckOutcome;
  /** Proposals created by this run; 0 unless the outcome is `ok`. */
  readonly proposed: number;
}

export interface CheckMailOptions {
  /** Bypass `not_due` and `cooldown`. The manual button and the CLI `--force`. */
  readonly force: boolean;
}

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function checkMailWithProposals(
  deps: MailCheckDeps,
  options: CheckMailOptions,
): Promise<MailCheckResult> {
  const stop = (outcome: MailCheckOutcome): MailCheckResult => ({ outcome, proposed: 0 });

  if (!deps.configured()) {
    return stop({ status: 'not_configured' });
  }

  let state: MailRunState;
  try {
    state = await deps.store.read();
  } catch (cause: unknown) {
    // The store refuses to overwrite a file it cannot read, because that file
    // holds the last success. Report it; never reset it here.
    deps.logger?.error(`Mail state unreadable: ${describe(cause)}`);
    return stop({ status: 'state_corrupt' });
  }

  const now = deps.now();
  if (!options.force) {
    if (!isMailRunDue(now, parseDate(state.lastSuccessAt))) {
      return stop({ status: 'not_due' });
    }
    if (!isMailCheckAllowed(now, state)) {
      return stop({ status: 'cooldown' });
    }
  }

  // `runMailCheck` advances `lastSuccessAt` before we propose. Remember the
  // previous value so a later failure can put it back (see the catch below).
  const previousSuccessAt = state.lastSuccessAt;
  let fetched = false;
  try {
    const result = await runMailCheck(
      {
        reader: deps.reader,
        store: deps.store,
        now: deps.now,
        ...(deps.logger === undefined ? {} : { logger: deps.logger }),
      },
      { force: options.force },
    );
    if (result.status !== 'ok') {
      return stop(result);
    }
    fetched = true;
    const proposal = await proposeFromMail({
      messages: result.messages,
      applications: await deps.applications.list(),
      repository: deps.proposals,
      now: deps.now,
    });
    return { outcome: result, proposed: proposal.proposed };
  } catch (cause: unknown) {
    deps.logger?.error(`Mail check failed: ${describe(cause)}`);
    if (fetched) {
      // The fetch was marked successful but its mails were not turned into
      // proposals. Undo the mark so the catch-up stays due and the same mails
      // are fetched again (proposals are idempotent by message id).
      try {
        await deps.store.update((current) => ({
          ...current,
          lastSuccessAt: previousSuccessAt,
          lastError: 'unexpected',
        }));
      } catch (restoreCause: unknown) {
        deps.logger?.error(`Mail success mark could not be restored: ${describe(restoreCause)}`);
      }
    }
    return stop({ status: 'failed' });
  }
}
