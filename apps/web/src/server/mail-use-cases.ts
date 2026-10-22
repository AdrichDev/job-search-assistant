import {
  acceptMailProposal,
  dismissMailProposal,
  tokenStatus,
  type AcceptMailProposalDeps,
  type AcceptMailProposalResult,
  type DismissMailProposalDeps,
  type DismissMailProposalResult,
  type Logger,
  type MailCheckDeps,
  type MailRunState,
  type TokenStatus,
} from '@job-queue/core';
import {
  acceptSlugFor,
  dismissSlugFor,
  type AcceptNoticeCode,
  type DismissNoticeCode,
} from '@/server/mail-notices';
/**
 * The mail check itself lives in core, because the scheduled `mail:check` CLI
 * runs the exact same pipeline as the on-open catch-up. Re-exported here so the
 * web keeps one import path and the sequence has a single owner.
 */
export { checkMailWithProposals as checkMail } from '@job-queue/core';
export type {
  CheckMailOptions,
  MailCheckDeps,
  MailCheckOutcome,
  MailCheckResult,
} from '@job-queue/core';

/**
 * Mail use cases for the web layer. No Next imports: every dependency is
 * injected so the module is unit-testable. Technical detail goes only to the
 * logger, never into a returned value.
 */

export interface MailStatus {
  readonly configured: boolean;
  readonly tokenStatus: TokenStatus;
  readonly lastSuccessAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastError: string | null;
  readonly pendingCount: number;
  readonly stateCorrupt: boolean;
}

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Read-only snapshot. A corrupt state file is `stateCorrupt: true` with safe defaults. */
export async function readMailStatus(
  deps: Pick<MailCheckDeps, 'configured' | 'store' | 'proposals' | 'now' | 'logger'>,
): Promise<MailStatus> {
  const configured = deps.configured();
  let state: MailRunState;
  try {
    state = await deps.store.read();
  } catch (cause: unknown) {
    deps.logger?.error(`Mail state unreadable: ${describe(cause)}`);
    return {
      configured,
      tokenStatus: 'unknown',
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      pendingCount: 0,
      stateCorrupt: true,
    };
  }

  let pendingCount = 0;
  try {
    pendingCount = (await deps.proposals.listPending()).length;
  } catch (cause: unknown) {
    deps.logger?.error(`Mail proposals unreadable: ${describe(cause)}`);
  }

  return {
    configured,
    tokenStatus: tokenStatus(
      deps.now(),
      parseDate(state.tokenIssuedAt),
      parseDate(state.authFailedAt),
    ),
    lastSuccessAt: state.lastSuccessAt,
    lastAttemptAt: state.lastAttemptAt,
    lastError: state.lastError,
    pendingCount,
    stateCorrupt: false,
  };
}

/** A repository threw: the caller shows the generic refusal, never the cause. */
export type FailedResult = { readonly status: 'failed' };

export type AcceptMailResult = AcceptMailProposalResult | FailedResult;
export type DismissMailResult = DismissMailProposalResult | FailedResult;

export async function acceptMail(
  proposalId: string,
  deps: AcceptMailProposalDeps,
  // Injection point for the core call (tests); defaults to the real one.
  run: (
    input: { readonly proposalId: string },
    deps: AcceptMailProposalDeps,
  ) => Promise<AcceptMailProposalResult> = acceptMailProposal,
): Promise<AcceptMailResult> {
  try {
    return await run({ proposalId }, deps);
  } catch (cause: unknown) {
    deps.logger?.error(`Accepting a mail proposal failed: ${describe(cause)}`);
    return { status: 'failed' };
  }
}

export async function dismissMail(
  proposalId: string,
  deps: DismissMailProposalDeps & { readonly logger?: Logger },
  run: (
    input: { readonly proposalId: string },
    deps: DismissMailProposalDeps,
  ) => Promise<DismissMailProposalResult> = dismissMailProposal,
): Promise<DismissMailResult> {
  try {
    return await run({ proposalId }, deps);
  } catch (cause: unknown) {
    deps.logger?.error(`Dismissing a mail proposal failed: ${describe(cause)}`);
    return { status: 'failed' };
  }
}

/** `failed` maps to the generic refusal. */
export function acceptSlugForResult(result: AcceptMailResult): AcceptNoticeCode {
  return result.status === 'failed' ? 'rechazada' : acceptSlugFor(result);
}

/*
 * Bulk accept (U5d): the modal's Aceptar applies EVERY pending proposal, each
 * one through the same per-proposal accept path, so every application change
 * stays append-only and reversible with history source `Correo`. The aggregate
 * reports how many proposals ended in each existing per-proposal outcome; it
 * never carries an error message or a path.
 */
export interface AcceptAllMailCounts {
  readonly accepted: number;
  readonly acceptedUntracked: number;
  readonly conflict: number;
  readonly alreadyDecided: number;
  readonly applicationNotFound: number;
  readonly refused: number;
  readonly notFound: number;
}

/**
 * The tallied counts ARE the success result (no wrapper object, so the shape a
 * notice composes from is exactly what the tests pin). A repository failure is
 * the typed failed result instead.
 */
export type AcceptAllMailResult = AcceptAllMailCounts | FailedResult;

/** Same shape, mutable, for the internal tally. */
type WritableCounts = { -readonly [K in keyof AcceptAllMailCounts]: AcceptAllMailCounts[K] };

const ZERO_COUNTS: AcceptAllMailCounts = {
  accepted: 0,
  acceptedUntracked: 0,
  conflict: 0,
  alreadyDecided: 0,
  applicationNotFound: 0,
  refused: 0,
  notFound: 0,
};

export async function acceptAllMail(
  deps: AcceptMailProposalDeps,
  run: (
    input: { readonly proposalId: string },
    deps: AcceptMailProposalDeps,
  ) => Promise<AcceptMailResult> = (input, innerDeps) => acceptMail(input.proposalId, innerDeps),
): Promise<AcceptAllMailResult> {
  let pending: readonly { readonly id: string }[];
  try {
    pending = await deps.proposals.listPending();
  } catch (cause: unknown) {
    deps.logger?.error(`Listing pending mail proposals failed: ${describe(cause)}`);
    return { status: 'failed' };
  }

  const counts: WritableCounts = { ...ZERO_COUNTS };
  for (const proposal of pending) {
    try {
      const result = await run({ proposalId: proposal.id }, deps);
      switch (result.status) {
        case 'accepted':
          counts.accepted += 1;
          break;
        case 'accepted_untracked':
          counts.acceptedUntracked += 1;
          break;
        case 'conflict':
          counts.conflict += 1;
          break;
        case 'already_decided':
          counts.alreadyDecided += 1;
          break;
        case 'application_not_found':
          counts.applicationNotFound += 1;
          break;
        case 'refused':
        case 'failed':
          // A per-proposal failure must not fail the batch: it is counted with
          // the refusals, which the notice words as "not applied".
          counts.refused += 1;
          break;
        case 'not_found':
          counts.notFound += 1;
          break;
      }
    } catch (cause: unknown) {
      deps.logger?.error(`Accepting proposal ${proposal.id} failed: ${describe(cause)}`);
      counts.refused += 1;
    }
  }
  return counts;
}

/** The dismiss notices have no refusal; `failed` shows the generic "not found". */
export function dismissSlugForResult(result: DismissMailResult): DismissNoticeCode {
  return result.status === 'failed' ? 'no-encontrada' : dismissSlugFor(result);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
