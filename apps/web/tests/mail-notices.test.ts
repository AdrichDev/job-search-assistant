import { describe, expect, it } from 'vitest';
import type {
  AcceptMailProposalResult,
  DismissMailProposalResult,
  MailUnavailableReason,
} from '@job-queue/core';
import {
  ACCEPT_NOTICE_CODES,
  DISMISS_NOTICE_CODES,
  RUN_NOTICE_CODES,
  acceptNoticeFor,
  acceptSlugFor,
  dismissNoticeFor,
  dismissSlugFor,
  runNoticeFor,
  runSlugFor,
  type MailRunOutcome,
} from '@/server/mail-notices';

const ACCEPT_STATUSES: Record<AcceptMailProposalResult['status'], true> = {
  accepted: true,
  accepted_untracked: true,
  not_found: true,
  already_decided: true,
  application_not_found: true,
  conflict: true,
  refused: true,
};
const DISMISS_STATUSES: Record<DismissMailProposalResult['status'], true> = {
  dismissed: true,
  not_found: true,
  already_decided: true,
};
const REASONS: Record<MailUnavailableReason, true> = {
  network: true,
  rate_limited: true,
  server: true,
  bad_response: true,
};

const RUN_OUTCOMES: readonly MailRunOutcome[] = [
  { status: 'ok', messages: [] },
  { status: 'auth_expired' },
  ...(Object.keys(REASONS) as MailUnavailableReason[]).map(
    (reason): MailRunOutcome => ({ status: 'unavailable', reason }),
  ),
  { status: 'not_due' },
  { status: 'already_running' },
  { status: 'failed' },
  { status: 'not_configured' },
  { status: 'state_corrupt' },
  { status: 'cooldown' },
];

describe('mail notices', () => {
  it('maps every slug to non-empty Spanish text', () => {
    const all = [
      ...ACCEPT_NOTICE_CODES.map((c) => acceptNoticeFor(c)),
      ...DISMISS_NOTICE_CODES.map((c) => dismissNoticeFor(c)),
      ...RUN_NOTICE_CODES.map((c) => runNoticeFor(c)),
    ];
    for (const notice of all) {
      expect(notice).not.toBeNull();
      expect(notice?.text.trim().length).toBeGreaterThan(0);
      expect(['ok', 'info', 'warning']).toContain(notice?.tone);
    }
  });

  it('has the agreed slug sets', () => {
    expect([...ACCEPT_NOTICE_CODES]).toEqual([
      'aceptada',
      'aceptada-sin-registro',
      'ya-aplicada',
      'ya-decidida',
      'sin-postulacion',
      'rechazada',
      'no-encontrada',
    ]);
    expect([...DISMISS_NOTICE_CODES]).toEqual(['descartada', 'ya-decidida', 'no-encontrada']);
    expect([...RUN_NOTICE_CODES]).toEqual([
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
    ]);
  });

  it('returns null for unknown or missing codes and never echoes the input', () => {
    const hostile = '<script>alert(1)</script>';
    for (const fn of [acceptNoticeFor, dismissNoticeFor, runNoticeFor]) {
      expect(fn(undefined)).toBeNull();
      expect(fn('')).toBeNull();
      expect(fn(hostile)).toBeNull();
      expect(fn(['aceptada'])).toBeNull();
      expect(fn('constructor')).toBeNull();
      expect(fn('__proto__')).toBeNull();
    }
    // a code from another family is unknown here too
    expect(dismissNoticeFor('aceptada')).toBeNull();
    expect(runNoticeFor('descartada')).toBeNull();
  });

  it('maps every core status to a slug that produces a notice', () => {
    for (const status of Object.keys(ACCEPT_STATUSES) as AcceptMailProposalResult['status'][]) {
      const result = (
        status === 'accepted'
          ? { status, historyEntryId: 'h' }
          : status === 'accepted_untracked'
            ? { status, historyEntryId: null }
            : status === 'refused'
              ? { status, reason: 'no_change' }
              : { status }
      ) as AcceptMailProposalResult;
      const slug = acceptSlugFor(result);
      expect(ACCEPT_NOTICE_CODES).toContain(slug);
      expect(acceptNoticeFor(slug)).not.toBeNull();
    }
    for (const status of Object.keys(DISMISS_STATUSES) as DismissMailProposalResult['status'][]) {
      const slug = dismissSlugFor({ status });
      expect(DISMISS_NOTICE_CODES).toContain(slug);
    }
    const slugs = new Set<string>();
    for (const outcome of RUN_OUTCOMES) {
      const slug = runSlugFor(outcome);
      expect(RUN_NOTICE_CODES).toContain(slug);
      slugs.add(slug);
    }
    expect(slugs.size).toBe(RUN_NOTICE_CODES.length);
  });

  it('maps statuses to the intended slugs', () => {
    expect(acceptSlugFor({ status: 'conflict' })).toBe('ya-aplicada');
    expect(acceptSlugFor({ status: 'application_not_found' })).toBe('sin-postulacion');
    expect(runSlugFor({ status: 'unavailable', reason: 'rate_limited' })).toBe('limite');
    expect(runSlugFor({ status: 'auth_expired' })).toBe('permiso-caducado');
  });

  it('uses the copy module texts', () => {
    expect(acceptNoticeFor('ya-aplicada')?.text).toContain('No se tocó nada');
    expect(runNoticeFor('estado-danado')?.text).toContain('Mueve el archivo');
  });
});
