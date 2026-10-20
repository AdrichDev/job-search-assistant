import type {
  AcceptMailProposalResult,
  DismissMailProposalResult,
  RunMailCheckResult,
} from '@job-queue/core';
import { ES } from '@/copy/es';

/**
 * Spanish slug codes carried in the URL after a mail action, and the notices
 * they stand for. Pure (no Next imports) so it is unit-testable.
 *
 * The code comes from the query string and is user-controlled: only the closed
 * sets below produce a notice, anything else is `null` and is never echoed.
 */

export interface MailNotice {
  readonly tone: 'ok' | 'info' | 'warning';
  readonly text: string;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled mail status: ${JSON.stringify(value)}`);
}

function lookup(
  table: Readonly<Record<string, MailNotice>>,
  raw: string | readonly string[] | undefined,
): MailNotice | null {
  if (typeof raw !== 'string' || !Object.hasOwn(table, raw)) {
    return null;
  }
  return table[raw] ?? null;
}

/* Accept ------------------------------------------------------------------ */

export const ACCEPT_NOTICE_CODES = [
  'aceptada',
  'aceptada-sin-registro',
  'ya-aplicada',
  'ya-decidida',
  'sin-postulacion',
  'rechazada',
  'no-encontrada',
] as const;
export type AcceptNoticeCode = (typeof ACCEPT_NOTICE_CODES)[number];

const ACCEPT_NOTICES: Readonly<Record<AcceptNoticeCode, MailNotice>> = {
  aceptada: { tone: 'ok', text: ES.mail.accept.accepted },
  'aceptada-sin-registro': { tone: 'warning', text: ES.mail.accept.accepted_untracked },
  'ya-aplicada': { tone: 'info', text: ES.mail.accept.conflict },
  'ya-decidida': { tone: 'info', text: ES.mail.accept.already_decided },
  'sin-postulacion': { tone: 'warning', text: ES.mail.accept.application_not_found },
  rechazada: { tone: 'warning', text: ES.mail.accept.refused },
  'no-encontrada': { tone: 'warning', text: ES.mail.accept.not_found },
};

export function acceptNoticeFor(raw: string | readonly string[] | undefined): MailNotice | null {
  return lookup(ACCEPT_NOTICES, raw);
}

export function acceptSlugFor(result: Pick<AcceptMailProposalResult, 'status'>): AcceptNoticeCode {
  const status = result.status;
  switch (status) {
    case 'accepted':
      return 'aceptada';
    case 'accepted_untracked':
      return 'aceptada-sin-registro';
    case 'conflict':
      return 'ya-aplicada';
    case 'already_decided':
      return 'ya-decidida';
    case 'application_not_found':
      return 'sin-postulacion';
    case 'refused':
      return 'rechazada';
    case 'not_found':
      return 'no-encontrada';
    default:
      return assertNever(status);
  }
}

/* Dismiss ----------------------------------------------------------------- */

export const DISMISS_NOTICE_CODES = ['descartada', 'ya-decidida', 'no-encontrada'] as const;
export type DismissNoticeCode = (typeof DISMISS_NOTICE_CODES)[number];

const DISMISS_NOTICES: Readonly<Record<DismissNoticeCode, MailNotice>> = {
  descartada: { tone: 'ok', text: ES.mail.dismiss.dismissed },
  'ya-decidida': { tone: 'info', text: ES.mail.dismiss.already_decided },
  'no-encontrada': { tone: 'warning', text: ES.mail.dismiss.not_found },
};

export function dismissNoticeFor(raw: string | readonly string[] | undefined): MailNotice | null {
  return lookup(DISMISS_NOTICES, raw);
}

export function dismissSlugFor(result: Pick<DismissMailProposalResult, 'status'>): DismissNoticeCode {
  const status = result.status;
  switch (status) {
    case 'dismissed':
      return 'descartada';
    case 'already_decided':
      return 'ya-decidida';
    case 'not_found':
      return 'no-encontrada';
    default:
      return assertNever(status);
  }
}

/* Run --------------------------------------------------------------------- */

export const RUN_NOTICE_CODES = [
  'ok',
  'no-configurado',
  'permiso-caducado',
  'sin-conexion',
  'limite',
  'servidor',
  'respuesta-rara',
  'fallo',
  'en-curso',
  'al-dia',
  'enfriamiento',
  'estado-danado',
] as const;
export type RunNoticeCode = (typeof RUN_NOTICE_CODES)[number];

const RUN_NOTICES: Readonly<Record<RunNoticeCode, MailNotice>> = {
  ok: { tone: 'ok', text: ES.mail.run.ok },
  'no-configurado': { tone: 'info', text: ES.mail.run.not_configured },
  'permiso-caducado': { tone: 'warning', text: ES.mail.run.auth_expired },
  'sin-conexion': { tone: 'warning', text: ES.mail.run.network },
  limite: { tone: 'warning', text: ES.mail.run.rate_limited },
  servidor: { tone: 'warning', text: ES.mail.run.server },
  'respuesta-rara': { tone: 'warning', text: ES.mail.run.bad_response },
  fallo: { tone: 'warning', text: ES.mail.run.failed },
  'en-curso': { tone: 'info', text: ES.mail.run.already_running },
  'al-dia': { tone: 'info', text: ES.mail.run.not_due },
  enfriamiento: { tone: 'info', text: ES.mail.run.cooldown },
  'estado-danado': { tone: 'warning', text: ES.mail.run.state_corrupt },
};

export function runNoticeFor(raw: string | readonly string[] | undefined): MailNotice | null {
  return lookup(RUN_NOTICES, raw);
}

/**
 * Everything a mail run can end as: the core result plus the three outcomes the
 * web layer decides itself (mail off, corrupt state file, retry cooldown).
 */
export type MailRunOutcome =
  | RunMailCheckResult
  | { readonly status: 'not_configured' }
  | { readonly status: 'state_corrupt' }
  | { readonly status: 'cooldown' };

export function runSlugFor(outcome: MailRunOutcome): RunNoticeCode {
  switch (outcome.status) {
    case 'ok':
      return 'ok';
    case 'auth_expired':
      return 'permiso-caducado';
    case 'unavailable': {
      const reason = outcome.reason;
      switch (reason) {
        case 'network':
          return 'sin-conexion';
        case 'rate_limited':
          return 'limite';
        case 'server':
          return 'servidor';
        case 'bad_response':
          return 'respuesta-rara';
        default:
          return assertNever(reason);
      }
    }
    case 'not_due':
      return 'al-dia';
    case 'already_running':
      return 'en-curso';
    case 'failed':
      return 'fallo';
    case 'not_configured':
      return 'no-configurado';
    case 'state_corrupt':
      return 'estado-danado';
    case 'cooldown':
      return 'enfriamiento';
    default:
      return assertNever(outcome);
  }
}
