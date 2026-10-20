import type { MailProposal } from '../domain/mail-proposal.js';

/**
 * Driven port for the pending suggestions that mail produces.
 *
 * `add` is idempotent by `messageId` as part of the contract: reading the same
 * mail twice (overlapping windows, a retry) must never create two proposals, and
 * a dismissed or accepted proposal keeps blocking its mail for good.
 */
export interface AddMailProposalResult {
  readonly proposal: MailProposal;
  /** False when a proposal for that messageId already existed (returned untouched). */
  readonly created: boolean;
}

export interface MailProposalRepository {
  /** Every proposal, newest detection first. */
  list(): Promise<readonly MailProposal[]>;
  /** Only `pending` ones, newest detection first. */
  listPending(): Promise<readonly MailProposal[]>;
  findByMessageId(messageId: string): Promise<MailProposal | null>;
  add(proposal: MailProposal): Promise<AddMailProposalResult>;
  /** `pending` -> `accepted`. Null when the id is unknown or no longer pending. */
  markAccepted(id: string, historyEntryId: string): Promise<MailProposal | null>;
  /** `pending` -> `dismissed`. Null when the id is unknown or no longer pending. */
  markDismissed(id: string): Promise<MailProposal | null>;
}
