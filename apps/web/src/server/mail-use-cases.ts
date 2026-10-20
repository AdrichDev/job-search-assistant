import {
  acceptMailProposal,
  dismissMailProposal,
  isMailCheckAllowed,
  isMailRunDue,
  proposeFromMail,
  runMailCheck,
  tokenStatus,
  type AcceptMailProposalDeps,
  type AcceptMailProposalResult,
  type ApplicationRepository,
  type DismissMailProposalDeps,
  type DismissMailProposalResult,
  type GmailReader,
  type Logger,
  type MailProposalRepository,
  type MailRunState,
  type MailRunStateStore,
  type TokenStatus,
} from '@job-queue/core';
import {
  acceptSlugFor,
  dismissSlugFor,
  type AcceptNoticeCode,
  type DismissNoticeCode,
  type MailRunOutcome,
} from '@/server/mail-notices';

/**
 * Mail use cases for the web layer. No Next imports: every dependency is
 * injected so the module is unit-testable. Technical detail goes only to the
 * logger, never into a returned value.
 */

export interface MailCheckDeps {
  readonly configured: () => boolean;
  readonly reader: GmailReader;
  readonly store: MailRunStateStore;
  readonly proposals: MailProposalRepository;
  readonly applications: Pick<ApplicationRepository, 'list'>;
  readonly now: () => Date;
  readonly logger?: Logger;
}

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

export interface MailCheckResult {
  readonly outcome: MailRunOutcome;
  /** Proposals created by this run; 0 unless the outcome is `ok`. */
  readonly proposed: number;
}

/**
 * One mail check. Order matters: nothing is written when mail is not configured
 * or the state file is corrupt.
 */
export async function checkMail(
  deps: MailCheckDeps,
  options: { readonly force: boolean },
): Promise<MailCheckResult> {
  const stop = (outcome: MailRunOutcome): MailCheckResult => ({ outcome, proposed: 0 });

  if (!deps.configured()) {
    return stop({ status: 'not_configured' });
  }

  let state: MailRunState;
  try {
    state = await deps.store.read();
  } catch (cause: unknown) {
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

/** The dismiss notices have no refusal; `failed` shows the generic "not found". */
export function dismissSlugForResult(result: DismissMailResult): DismissNoticeCode {
  return result.status === 'failed' ? 'no-encontrada' : dismissSlugFor(result);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
