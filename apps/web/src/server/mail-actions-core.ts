import {
  acceptMail,
  acceptAllMail,
  checkMail,
  dismissMail,
  readMailStatus,
  acceptSlugForResult,
  dismissSlugForResult,
  type AcceptAllMailResult,
  type AcceptMailResult,
  type DismissMailResult,
  type MailCheckDeps,
} from '@/server/mail-use-cases';
import { runSlugFor, type MailRunOutcome } from '@/server/mail-notices';
import { isMailCheckAllowed, isMailRunDue } from '@job-queue/core';
import type { AcceptMailProposalDeps, DismissMailProposalDeps } from '@job-queue/core';

/**
 * Logic behind the mail server actions, free of Next imports so it is
 * unit-testable. `app/mail-actions.ts` is a thin shell over these functions.
 * Redirect targets carry only a closed slug, never a message or a path.
 */

const MAX_PROPOSAL_ID_LENGTH = 200;

function target(slug: string): string {
  return `/seguimiento?correo=${slug}#correo`;
}

export function acceptRedirect(result: AcceptMailResult): string {
  return target(acceptSlugForResult(result));
}

export function dismissRedirect(result: DismissMailResult): string {
  return target(dismissSlugForResult(result));
}

export function checkRedirect(outcome: MailRunOutcome): string {
  return target(runSlugFor(outcome));
}

/**
 * Query keys of the bulk-accept count buckets, in the fixed order the notice
 * composes them from. The only place these names exist besides `mail-notices`.
 */
const BULK_COUNT_KEYS = [
  ['accepted', 'aplicados'],
  ['acceptedUntracked', 'sin-registro'],
  ['conflict', 'conflicto'],
  ['alreadyDecided', 'ya-decididas'],
  ['applicationNotFound', 'sin-postulacion'],
  ['refused', 'rechazadas'],
  ['notFound', 'no-encontradas'],
] as const satisfies readonly (readonly [keyof AcceptAllCounts, string])[];

type AcceptAllCounts = NonNullable<Exclude<AcceptAllMailResult, { status: 'failed' }>>;

export function bulkAcceptRedirect(result: AcceptAllMailResult): string {
  if ('status' in result) {
    // The generic refusal slug: the same one a single refused accept uses.
    return target('rechazada');
  }
  const params = BULK_COUNT_KEYS.filter(([key]) => result[key] > 0)
    .map(([key, name]) => `${name}=${result[key]}`);
  return ['/seguimiento?correo=aplicadas', ...params].join('&') + '#correo';
}

/** A non-empty string of at most 200 characters, or null. */
export function parseProposalId(formData: FormData): string | null {
  const value = formData.get('proposalId');
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PROPOSAL_ID_LENGTH
    ? value
    : null;
}

type AcceptRun = Parameters<typeof acceptMail>[2];
type DismissRun = Parameters<typeof dismissMail>[2];

export async function acceptFromForm(
  formData: FormData,
  deps: AcceptMailProposalDeps,
  run?: AcceptRun,
): Promise<string> {
  const proposalId = parseProposalId(formData);
  if (proposalId === null) {
    return acceptRedirect({ status: 'not_found' });
  }
  try {
    return acceptRedirect(await acceptMail(proposalId, deps, run));
  } catch {
    return acceptRedirect({ status: 'failed' });
  }
}

/**
 * The modal's Aceptar: no form fields to parse, every pending proposal is
 * applied. An unexpected failure lands on the generic refusal slug, which
 * carries no message and no path.
 */
export async function acceptAllFromForm(
  deps: AcceptMailProposalDeps,
  run?: AcceptRun,
): Promise<string> {
  try {
    return bulkAcceptRedirect(await acceptAllMail(deps, run));
  } catch {
    return target('rechazada');
  }
}

export async function dismissFromForm(
  formData: FormData,
  deps: DismissMailProposalDeps,
  run?: DismissRun,
): Promise<string> {
  const proposalId = parseProposalId(formData);
  if (proposalId === null) {
    return dismissRedirect({ status: 'not_found' });
  }
  try {
    return dismissRedirect(await dismissMail(proposalId, deps, run));
  } catch {
    return dismissRedirect({ status: 'failed' });
  }
}

/** The manual "check now" button: forced, bypasses not-due and cooldown. */
export async function checkNow(deps: MailCheckDeps): Promise<string> {
  try {
    return checkRedirect((await checkMail(deps, { force: true })).outcome);
  } catch {
    return checkRedirect({ status: 'failed' });
  }
}

export interface CatchUpResult {
  /** True when a run was attempted, so the page data may have changed. */
  readonly ran: boolean;
  readonly outcome: MailRunOutcome;
}

/**
 * On-open catch-up. Never forced. Skips (ran false) when mail is off, the state
 * is corrupt, nothing is due or the retry cooldown applies. Never throws.
 */
export async function catchUp(deps: MailCheckDeps): Promise<CatchUpResult> {
  try {
    const status = await readMailStatus(deps);
    if (!status.configured) {
      return { ran: false, outcome: { status: 'not_configured' } };
    }
    if (status.stateCorrupt) {
      return { ran: false, outcome: { status: 'state_corrupt' } };
    }
    const now = deps.now();
    const lastSuccess = status.lastSuccessAt === null ? null : new Date(status.lastSuccessAt);
    const successAt = lastSuccess !== null && Number.isNaN(lastSuccess.getTime()) ? null : lastSuccess;
    if (!isMailRunDue(now, successAt)) {
      return { ran: false, outcome: { status: 'not_due' } };
    }
    if (
      !isMailCheckAllowed(now, {
        lastAttemptAt: status.lastAttemptAt,
        lastSuccessAt: status.lastSuccessAt,
      })
    ) {
      return { ran: false, outcome: { status: 'cooldown' } };
    }
    const { outcome } = await checkMail(deps, { force: false });
    const skipped =
      outcome.status === 'not_configured' ||
      outcome.status === 'state_corrupt' ||
      outcome.status === 'not_due' ||
      outcome.status === 'cooldown' ||
      outcome.status === 'already_running';
    return { ran: !skipped, outcome };
  } catch {
    return { ran: false, outcome: { status: 'failed' } };
  }
}
