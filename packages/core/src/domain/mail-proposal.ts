/**
 * A pending suggestion, born from a company reply, that the user may confirm.
 *
 * Mail NEVER changes an application: it only creates one of these. Accepting or
 * dismissing is the user's decision, handled elsewhere.
 *
 * Privacy: only a short sanitized snippet is stored, never a body. `messageId` is
 * the dedupe key, so reading the same mail twice proposes once.
 */

import type { ApplicationOutcome } from './application.js';

export const MAIL_PROPOSAL_OUTCOMES = ['rejected', 'screening', 'interview', 'offer'] as const;
export type MailProposalOutcome = (typeof MAIL_PROPOSAL_OUTCOMES)[number];

export const MAIL_PROPOSAL_STATUSES = ['pending', 'accepted', 'dismissed'] as const;
export type MailProposalStatus = (typeof MAIL_PROPOSAL_STATUSES)[number];

export const MAX_PROPOSAL_SNIPPET_LENGTH = 200;

export interface MailProposal {
  readonly id: string;
  readonly jobId: string;
  readonly proposedOutcome: MailProposalOutcome;
  /**
   * The application's outcome when the proposal was made. Accepting refuses if it
   * changed since (a newer human decision is never overwritten). Absent on
   * proposals stored before this field existed.
   */
  readonly basedOnOutcome?: ApplicationOutcome;
  /** Gmail message id: the idempotency key. */
  readonly messageId: string;
  readonly snippet: string;
  readonly evidence: readonly string[];
  readonly detectedAt: Date;
  readonly status: MailProposalStatus;
  /** Set when accepted: the change-history entry that recorded the edit. */
  readonly historyEntryId?: string;
}

export interface MailProposalDraft {
  readonly id: string;
  readonly jobId: string;
  readonly proposedOutcome: MailProposalOutcome;
  readonly basedOnOutcome?: ApplicationOutcome;
  readonly messageId: string;
  readonly snippet: string;
  readonly evidence: readonly string[];
  readonly detectedAt: Date;
}

export function isMailProposalOutcome(value: unknown): value is MailProposalOutcome {
  return typeof value === 'string' && (MAIL_PROPOSAL_OUTCOMES as readonly string[]).includes(value);
}

/** Control characters are removed; tabs and line breaks fold into one space. */
export function sanitizeSnippet(raw: string): string {
  return raw
    .replace(/[\t\r\n]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_PROPOSAL_SNIPPET_LENGTH)
    .trim();
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`A mail proposal needs a non-empty ${field}.`);
  }
  return trimmed;
}

/** Builds a PENDING proposal. Picks known fields only, so a stray body can never be stored. */
export function createMailProposal(draft: MailProposalDraft): MailProposal {
  if (!isMailProposalOutcome(draft.proposedOutcome)) {
    throw new Error('A mail proposal needs a proposed outcome a reply can announce.');
  }
  if (Number.isNaN(draft.detectedAt.getTime())) {
    throw new Error('A mail proposal needs a valid detection date.');
  }
  return {
    id: requireText(draft.id, 'id'),
    jobId: requireText(draft.jobId, 'jobId'),
    proposedOutcome: draft.proposedOutcome,
    ...(draft.basedOnOutcome === undefined ? {} : { basedOnOutcome: draft.basedOnOutcome }),
    messageId: requireText(draft.messageId, 'messageId'),
    snippet: sanitizeSnippet(draft.snippet),
    evidence: [...draft.evidence],
    detectedAt: draft.detectedAt,
    status: 'pending',
  };
}
