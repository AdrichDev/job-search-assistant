import { describe, expect, it, vi } from 'vitest';
import type { MailRunState } from '@job-queue/core';
import { EMPTY_MAIL_RUN_STATE } from '@job-queue/core';
import {
  acceptFromForm,
  acceptRedirect,
  catchUp,
  checkNow,
  checkRedirect,
  dismissFromForm,
  dismissRedirect,
  parseProposalId,
} from '@/server/mail-actions-core';
import type { MailCheckDeps } from '@/server/mail-use-cases';

const NOW = new Date('2026-03-10T12:00:00.000Z'); // 13:00 Madrid, after the 08:00 run

function form(entries: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('redirect targets', () => {
  it('maps every accept status to its exact path', () => {
    const cases = [
      ['accepted', 'aceptada'],
      ['accepted_untracked', 'aceptada-sin-registro'],
      ['conflict', 'ya-aplicada'],
      ['already_decided', 'ya-decidida'],
      ['application_not_found', 'sin-postulacion'],
      ['refused', 'rechazada'],
      ['not_found', 'no-encontrada'],
      ['failed', 'rechazada'],
    ] as const;
    for (const [status, slug] of cases) {
      expect(acceptRedirect({ status } as never)).toBe(`/seguimiento?correo=${slug}#correo`);
    }
  });

  it('maps every dismiss status to its exact path', () => {
    const cases = [
      ['dismissed', 'descartada'],
      ['already_decided', 'ya-decidida'],
      ['not_found', 'no-encontrada'],
      ['failed', 'no-encontrada'],
    ] as const;
    for (const [status, slug] of cases) {
      expect(dismissRedirect({ status } as never)).toBe(`/seguimiento?correo=${slug}#correo`);
    }
  });

  it('maps run outcomes to their exact path', () => {
    expect(checkRedirect({ status: 'ok' } as never)).toBe('/seguimiento?correo=ok#correo');
    expect(checkRedirect({ status: 'auth_expired' })).toBe(
      '/seguimiento?correo=permiso-caducado#correo',
    );
    expect(checkRedirect({ status: 'unavailable', reason: 'network' })).toBe(
      '/seguimiento?correo=sin-conexion#correo',
    );
    expect(checkRedirect({ status: 'not_configured' })).toBe(
      '/seguimiento?correo=no-configurado#correo',
    );
    expect(checkRedirect({ status: 'state_corrupt' })).toBe(
      '/seguimiento?correo=estado-danado#correo',
    );
    expect(checkRedirect({ status: 'failed' })).toBe('/seguimiento?correo=fallo#correo');
  });
});

describe('parseProposalId', () => {
  it('accepts a non-empty string up to 200 characters', () => {
    expect(parseProposalId(form({ proposalId: 'p1' }))).toBe('p1');
    expect(parseProposalId(form({ proposalId: 'a'.repeat(200) }))).toBe('a'.repeat(200));
  });

  it('rejects missing, empty, too long and non-string values', () => {
    expect(parseProposalId(form({}))).toBeNull();
    expect(parseProposalId(form({ proposalId: '' }))).toBeNull();
    expect(parseProposalId(form({ proposalId: 'a'.repeat(201) }))).toBeNull();
    expect(parseProposalId(form({ proposalId: new File(['x'], 'x.txt') }))).toBeNull();
  });
});

describe('accept / dismiss from a form', () => {
  it('never reaches the use case with an invalid id and redirects not-found', async () => {
    const accept = vi.fn();
    const dismiss = vi.fn();
    expect(await acceptFromForm(form({}), {} as never, accept)).toBe(
      '/seguimiento?correo=no-encontrada#correo',
    );
    expect(await dismissFromForm(form({ proposalId: '' }), {} as never, dismiss)).toBe(
      '/seguimiento?correo=no-encontrada#correo',
    );
    expect(accept).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('passes the id to the use case and redirects with its result', async () => {
    const accept = vi.fn(async () => ({ status: 'accepted', historyEntryId: 'h1' }) as const);
    const dismiss = vi.fn(async () => ({ status: 'dismissed' }) as const);
    expect(await acceptFromForm(form({ proposalId: 'p1' }), {} as never, accept)).toBe(
      '/seguimiento?correo=aceptada#correo',
    );
    expect(await dismissFromForm(form({ proposalId: 'p2' }), {} as never, dismiss)).toBe(
      '/seguimiento?correo=descartada#correo',
    );
    expect(accept).toHaveBeenCalledWith({ proposalId: 'p1' }, expect.anything());
    expect(dismiss).toHaveBeenCalledWith({ proposalId: 'p2' }, expect.anything());
  });

  it('turns a thrown use case into the generic slug, never echoing the message', async () => {
    const boom = async () => {
      throw new Error('C:\\secret\\path');
    };
    const a = await acceptFromForm(form({ proposalId: 'p1' }), {} as never, boom);
    const d = await dismissFromForm(form({ proposalId: 'p1' }), {} as never, boom);
    expect(a).toBe('/seguimiento?correo=rechazada#correo');
    expect(d).toBe('/seguimiento?correo=no-encontrada#correo');
    expect(a + d).not.toContain('secret');
  });
});

function build(opts: { configured?: boolean; state?: MailRunState | 'corrupt'; fetch?: () => unknown }) {
  const fetchRecent = vi.fn(async () => (opts.fetch ? opts.fetch() : { status: 'ok', messages: [] }));
  let state: MailRunState = opts.state === 'corrupt' ? EMPTY_MAIL_RUN_STATE : (opts.state ?? EMPTY_MAIL_RUN_STATE);
  const corrupt = opts.state === 'corrupt';
  const deps = {
    configured: () => opts.configured ?? true,
    reader: { fetchRecent },
    store: {
      read: async () => {
        if (corrupt) throw new Error('corrupt');
        return state;
      },
      write: async (next: MailRunState) => {
        state = next;
      },
      update: async (change: (s: MailRunState) => MailRunState) => {
        if (corrupt) throw new Error('corrupt');
        state = change(state);
        return state;
      },
    },
    proposals: {
      list: async () => [],
      listPending: async () => [],
      findByMessageId: async () => null,
      add: vi.fn(),
    },
    applications: { list: async () => [] },
    now: () => NOW,
  } as unknown as MailCheckDeps;
  return { deps, fetchRecent };
}

const DUE: MailRunState = { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-08T07:00:00.000Z' };

describe('catchUp', () => {
  it('does not call the reader when not configured', async () => {
    const { deps, fetchRecent } = build({ configured: false, state: DUE });
    const result = await catchUp(deps);
    expect(result).toEqual({ ran: false, outcome: { status: 'not_configured' } });
    expect(fetchRecent).not.toHaveBeenCalled();
  });

  it('does not call the reader when the state is corrupt', async () => {
    const { deps, fetchRecent } = build({ state: 'corrupt' });
    const result = await catchUp(deps);
    expect(result.ran).toBe(false);
    expect(result.outcome.status).toBe('state_corrupt');
    expect(fetchRecent).not.toHaveBeenCalled();
  });

  it('does not run when not due', async () => {
    const { deps, fetchRecent } = build({
      state: { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-10T09:00:00.000Z' },
    });
    const result = await catchUp(deps);
    expect(result.ran).toBe(false);
    expect(result.outcome.status).toBe('not_due');
    expect(fetchRecent).not.toHaveBeenCalled();
  });

  it('does not run inside the retry cooldown', async () => {
    const { deps, fetchRecent } = build({
      state: { ...DUE, lastAttemptAt: '2026-03-10T11:50:00.000Z' },
    });
    const result = await catchUp(deps);
    expect(result.ran).toBe(false);
    expect(result.outcome.status).toBe('cooldown');
    expect(fetchRecent).not.toHaveBeenCalled();
  });

  it('runs exactly once, without force, when due and allowed', async () => {
    const { deps, fetchRecent } = build({ state: DUE });
    const result = await catchUp(deps);
    expect(result.ran).toBe(true);
    expect(result.outcome.status).toBe('ok');
    expect(fetchRecent).toHaveBeenCalledTimes(1);
  });

  it('reports ran true when the run executed but failed upstream', async () => {
    const { deps } = build({ state: DUE, fetch: () => ({ status: 'auth_expired' }) });
    const result = await catchUp(deps);
    expect(result).toEqual({ ran: true, outcome: { status: 'auth_expired' } });
  });

  it('reports ran false when checkMail reports another run in flight', async () => {
    const { deps } = build({ state: { ...DUE, runningSince: NOW.toISOString() } });
    const result = await catchUp(deps);
    expect(result.ran).toBe(false);
    expect(result.outcome.status).toBe('already_running');
  });

  it('never throws: an unexpected throw is ran false with a failed outcome', async () => {
    const { deps } = build({ state: DUE });
    const broken = { ...deps, configured: () => { throw new Error('boom'); } } as MailCheckDeps;
    await expect(catchUp(broken)).resolves.toEqual({ ran: false, outcome: { status: 'failed' } });
  });
});

describe('checkNow (manual button)', () => {
  it('forces the run even when not due and inside the cooldown', async () => {
    const { deps, fetchRecent } = build({
      state: { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-10T09:00:00.000Z', lastAttemptAt: '2026-03-10T11:55:00.000Z' },
    });
    expect(await checkNow(deps)).toBe('/seguimiento?correo=ok#correo');
    expect(fetchRecent).toHaveBeenCalledTimes(1);
  });

  it('redirects with not-configured and does not read', async () => {
    const { deps, fetchRecent } = build({ configured: false });
    expect(await checkNow(deps)).toBe('/seguimiento?correo=no-configurado#correo');
    expect(fetchRecent).not.toHaveBeenCalled();
  });

  it('redirects with the generic failure slug on an unexpected throw', async () => {
    const { deps } = build({});
    const broken = { ...deps, configured: () => { throw new Error('C:\\secret'); } } as MailCheckDeps;
    expect(await checkNow(broken)).toBe('/seguimiento?correo=fallo#correo');
  });
});
