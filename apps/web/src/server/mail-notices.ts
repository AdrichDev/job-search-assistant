import type {
  AcceptMailProposalResult,
  DismissMailProposalResult,
  MailCheckOutcome,
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

/*
 * Bulk accept (U5d). One slug, like the other families; the counts travel as
 * separate query keys and are composed into the notice here.
 */
export const BULK_ACCEPT_NOTICE_CODES = ['aplicadas'] as const;
export type BulkAcceptNoticeCode = (typeof BULK_ACCEPT_NOTICE_CODES)[number];

const BULK_ACCEPT_CODES: Readonly<Record<BulkAcceptNoticeCode, true>> = { aplicadas: true };

type RawCount = string | readonly string[] | undefined;

/** A count is ours or it is nothing: at most 4 digits, so garbage, negatives and absurd values are dropped. */
function parseCount(raw: RawCount): number {
  if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw)) {
    return 0;
  }
  return Number.parseInt(raw, 10);
}

/** Bucket query key → copy, in the fixed order the lines appear in. */
const BULK_LINES: readonly (readonly [string, (n: number) => string])[] = [
  ['aplicados', ES.mail.bulk.applied],
  ['sin-registro', ES.mail.bulk.untracked],
  ['conflicto', ES.mail.bulk.conflict],
  ['ya-decididas', ES.mail.bulk.decided],
  ['sin-postulacion', ES.mail.bulk.gone],
  ['rechazadas', ES.mail.bulk.refused],
  ['no-encontradas', ES.mail.bulk.missing],
];

export function bulkAcceptNoticeFor(
  raw: RawCount,
  counts: Readonly<Record<string, RawCount>>,
): MailNotice | null {
  if (typeof raw !== 'string' || !Object.hasOwn(BULK_ACCEPT_CODES, raw)) {
    return null;
  }
  const lines: string[] = [];
  let applied = 0;
  let untracked = 0;
  for (const [key, line] of BULK_LINES) {
    const n = parseCount(counts[key]);
    if (n > 0) {
      lines.push(line(n));
    }
    if (key === 'aplicados') {
      applied = n;
    }
    if (key === 'sin-registro') {
      untracked = n;
    }
  }
  if (lines.length === 0) {
    return { tone: 'info', text: ES.mail.bulk.empty };
  }
  const nonPositive = lines.length - (applied > 0 ? 1 : 0) - (untracked > 0 ? 1 : 0);
  const tone: MailNotice['tone'] =
    applied > 0 ? (nonPositive === 0 && untracked === 0 ? 'ok' : 'info') : 'warning';
  return { tone, text: lines.join(' ') };
}

/**
 * One lookup for the page: every mail slug family resolves here, bulk counts
 * included. Anything unknown stays null and is never echoed.
 */
export function mailNoticeFor(
  raw: RawCount,
  counts: Readonly<Record<string, RawCount>> = {},
): MailNotice | null {
  return (
    bulkAcceptNoticeFor(raw, counts) ??
    acceptNoticeFor(raw) ??
    dismissNoticeFor(raw) ??
    runNoticeFor(raw)
  );
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
 * Everything a mail run can end as. Derived from the core type rather than
 * re-listed here, so a new outcome fails this file's exhaustive switch at the
 * typecheck instead of silently rendering nothing.
 */
export type MailRunOutcome = MailCheckOutcome;

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

/**
 * The Spanish sentence for a mail run outcome, reused by the "Actualizar"
 * panel so its mail line words the outcome exactly like /seguimiento does.
 * Every outcome maps through the closed slug set; anything unmapped falls back
 * to the generic failure text and is never echoed.
 */
export function mailRunText(outcome: MailRunOutcome): string {
  return runNoticeFor(runSlugFor(outcome))?.text ?? ES.mail.run.failed;
}
