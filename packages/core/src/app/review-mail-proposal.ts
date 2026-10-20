import { editApplication } from './edit-application.js';
import type { PatchRefusalReason } from '../domain/application.js';
import type { ApplicationHistoryRepository } from '../ports/application-history-repository.js';
import type { ApplicationRepository } from '../ports/application-repository.js';
import type { Logger } from '../ports/logger.js';
import type { MailProposalRepository } from '../ports/mail-proposal-repository.js';

/**
 * The user's decision on a mail proposal (CU7, CU14).
 *
 * Accepting goes through the existing edit use case with source `email`, so the
 * change is append-only and reversible with the existing revert. The proposal is
 * a record of a decision: reverting the change leaves it `accepted`.
 *
 * A newer human decision is never overwritten: if the application's outcome is no
 * longer the one the proposal was built against (or already is the proposed one)
 * the answer is `conflict` and nothing is written. Proposals stored before
 * `basedOnOutcome` existed are compared with the proposed outcome only.
 *
 * Expected cases are typed statuses. Technical detail goes only to the optional
 * logger, never into a result.
 */

export interface AcceptMailProposalInput {
  readonly proposalId: string;
}

export interface AcceptMailProposalDeps {
  readonly proposals: MailProposalRepository;
  readonly applications: ApplicationRepository;
  readonly history: ApplicationHistoryRepository;
  readonly now: () => Date;
  readonly newId?: () => string;
  readonly logger?: Logger;
}

export type AcceptMailProposalResult =
  | { readonly status: 'accepted'; readonly historyEntryId: string }
  /**
   * The edit exists, but the proposal could not be marked accepted (it may still
   * look pending). History is append-only: nothing is rolled back.
   * `historyEntryId` is null only when the edit was saved but its entry could not
   * be written either.
   */
  | { readonly status: 'accepted_untracked'; readonly historyEntryId: string | null }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_decided' }
  | { readonly status: 'application_not_found' }
  | { readonly status: 'conflict' }
  | { readonly status: 'refused'; readonly reason: PatchRefusalReason };

export async function acceptMailProposal(
  input: AcceptMailProposalInput,
  deps: AcceptMailProposalDeps,
): Promise<AcceptMailProposalResult> {
  const proposal = (await deps.proposals.list()).find(
    (candidate) => candidate.id === input.proposalId,
  );
  if (proposal === undefined) {
    return { status: 'not_found' };
  }
  if (proposal.status !== 'pending') {
    return { status: 'already_decided' };
  }

  const application = await deps.applications.findByJobId(proposal.jobId);
  if (application === null) {
    return { status: 'application_not_found' };
  }
  if (
    application.outcome === proposal.proposedOutcome ||
    (proposal.basedOnOutcome !== undefined && application.outcome !== proposal.basedOnOutcome)
  ) {
    return { status: 'conflict' };
  }

  const edit = await editApplication(
    { jobId: proposal.jobId, patch: { outcome: proposal.proposedOutcome }, source: 'email' },
    {
      repository: deps.applications,
      history: deps.history,
      now: deps.now,
      ...(deps.newId === undefined ? {} : { newId: deps.newId }),
    },
  );
  if (edit.status === 'invalid') {
    return { status: 'refused', reason: edit.reason };
  }
  if (edit.status === 'not_found') {
    return { status: 'application_not_found' };
  }
  if (edit.status === 'unchanged') {
    return { status: 'conflict' };
  }

  const historyEntryId = edit.historyEntryId ?? null;
  if (historyEntryId === null) {
    deps.logger?.error(
      `Mail proposal ${proposal.id}: the edit was saved but its history entry was not written.`,
    );
    return { status: 'accepted_untracked', historyEntryId: null };
  }

  try {
    const marked = await deps.proposals.markAccepted(proposal.id, historyEntryId);
    if (marked === null) {
      deps.logger?.warn(
        `Mail proposal ${proposal.id}: markAccepted returned nothing after the edit was applied.`,
      );
      return { status: 'accepted_untracked', historyEntryId };
    }
  } catch (cause: unknown) {
    deps.logger?.error(
      `Mail proposal ${proposal.id}: markAccepted failed after the edit was applied: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return { status: 'accepted_untracked', historyEntryId };
  }
  return { status: 'accepted', historyEntryId };
}

export interface DismissMailProposalInput {
  readonly proposalId: string;
}

export interface DismissMailProposalDeps {
  readonly proposals: MailProposalRepository;
}

export type DismissMailProposalResult =
  | { readonly status: 'dismissed' }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_decided' };

/** Only marks the proposal. It has no access to applications or history. */
export async function dismissMailProposal(
  input: DismissMailProposalInput,
  deps: DismissMailProposalDeps,
): Promise<DismissMailProposalResult> {
  const proposal = (await deps.proposals.list()).find(
    (candidate) => candidate.id === input.proposalId,
  );
  if (proposal === undefined) {
    return { status: 'not_found' };
  }
  if (proposal.status !== 'pending') {
    return { status: 'already_decided' };
  }
  const marked = await deps.proposals.markDismissed(proposal.id);
  return marked === null ? { status: 'already_decided' } : { status: 'dismissed' };
}
