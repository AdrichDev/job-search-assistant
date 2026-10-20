import { describe, expect, it, vi } from 'vitest';
import type {
  AcceptMailProposalResult,
  Application,
  DismissMailProposalResult,
  GmailFetchResult,
  GmailReader,
  MailMessage,
  MailProposal,
  MailProposalRepository,
  MailRunState,
  MailRunStateStore,
} from '@job-queue/core';
import { EMPTY_MAIL_RUN_STATE } from '@job-queue/core';
import {
  acceptMail,
  acceptSlugForResult,
  checkMail,
  dismissMail,
  dismissSlugForResult,
  readMailStatus,
  type MailCheckDeps,
} from '@/server/mail-use-cases';
import { isMailRunDue } from '@job-queue/core';
import { runSlugFor } from '@/server/mail-notices';

const NOW = new Date('2026-03-10T12:00:00.000Z'); // 13:00 Madrid, after the 08:00 run
const SECRET_PATH = 'C:\\secret\\place\\.mail-run.json';

function storeWith(initial: MailRunState | 'corrupt') {
  let state: MailRunState = initial === 'corrupt' ? EMPTY_MAIL_RUN_STATE : initial;
  const corrupt = initial === 'corrupt';
  const write = vi.fn(async (next: MailRunState) => {
    state = next;
  });
  const store: MailRunStateStore = {
    read: async () => {
      if (corrupt) throw new Error(`Corrupt state at ${SECRET_PATH}`);
      return state;
    },
    write,
    update: async (change) => {
      if (corrupt) throw new Error(`Corrupt state at ${SECRET_PATH}`);
      state = change(state);
      await write(state);
      return state;
    },
  };
  return { store, write, get: () => state };
}

const MESSAGE: MailMessage = {
  id: 'm1',
  threadId: 't1',
  receivedAt: new Date('2026-03-10T09:00:00.000Z'),
  from: 'rrhh@acme.com',
  subject: 'Entrevista con Acme',
  snippet: 'Acme: te invitamos a una entrevista.',
};

function application(): Application {
  return {
    jobId: 'acme::dev::1',
    outcome: 'applied',
    appliedAt: new Date('2026-03-01T00:00:00.000Z'),
    outcomeUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
    listing: { company: 'Acme', title: 'Dev', url: 'https://example.test/1' },
  } as unknown as Application;
}

function proposalsRepo() {
  const added: unknown[] = [];
  const repo = {
    list: async () => [] as readonly MailProposal[],
    listPending: async () => [] as readonly MailProposal[],
    findByMessageId: async () => null,
    add: vi.fn(async (draft: unknown) => {
      added.push(draft);
      return { proposal: draft as MailProposal, created: true };
    }),
  } as unknown as MailProposalRepository;
  return { repo, added };
}

function build(opts: {
  configured?: boolean;
  state?: MailRunState | 'corrupt';
  result?: GmailFetchResult | Error;
  apps?: readonly Application[];
  proposals?: MailProposalRepository;
}) {
  const s = storeWith(opts.state ?? EMPTY_MAIL_RUN_STATE);
  const p = proposalsRepo();
  const fetchRecent = vi.fn(async () => {
    const r = opts.result ?? { status: 'ok' as const, messages: [] };
    if (r instanceof Error) throw r;
    return r;
  });
  const reader: GmailReader = { fetchRecent };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: MailCheckDeps = {
    configured: () => opts.configured ?? true,
    reader,
    store: s.store,
    proposals: opts.proposals ?? p.repo,
    applications: { list: async () => opts.apps ?? [application()] },
    now: () => NOW,
    logger,
  };
  return { deps, s, p, fetchRecent, logger };
}

const RECENT_OK: MailRunState = { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-10T08:30:00.000Z' };
const OLD: MailRunState = { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-08T08:30:00.000Z' };

describe('checkMail', () => {
  it('not configured writes nothing and never reads', async () => {
    const t = build({ configured: false });
    const r = await checkMail(t.deps, { force: true });
    expect(r.outcome).toEqual({ status: 'not_configured' });
    expect(t.s.write).not.toHaveBeenCalled();
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('corrupt state returns state_corrupt without throwing or leaking', async () => {
    const t = build({ state: 'corrupt' });
    const r = await checkMail(t.deps, { force: true });
    expect(r.outcome).toEqual({ status: 'state_corrupt' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(t.fetchRecent).not.toHaveBeenCalled();
    expect(t.s.write).not.toHaveBeenCalled();
  });

  it('not due when the last success is after the 08:00 run', async () => {
    const t = build({ state: RECENT_OK });
    expect((await checkMail(t.deps, { force: false })).outcome).toEqual({ status: 'not_due' });
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('cooldown after a failed attempt 10 minutes ago', async () => {
    const t = build({ state: { ...OLD, lastAttemptAt: '2026-03-10T11:50:00.000Z' } });
    expect((await checkMail(t.deps, { force: false })).outcome).toEqual({ status: 'cooldown' });
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('force bypasses cooldown and not_due', async () => {
    const cooling = build({ state: { ...OLD, lastAttemptAt: '2026-03-10T11:50:00.000Z' } });
    expect((await checkMail(cooling.deps, { force: true })).outcome.status).toBe('ok');
    const fresh = build({ state: RECENT_OK });
    expect((await checkMail(fresh.deps, { force: true })).outcome.status).toBe('ok');
    expect(fresh.fetchRecent).toHaveBeenCalledTimes(1);
  });

  it('ok creates proposals through the matcher and returns the count', async () => {
    const t = build({ state: OLD, result: { status: 'ok', messages: [MESSAGE] } });
    const r = await checkMail(t.deps, { force: false });
    expect(r.outcome.status).toBe('ok');
    expect(r.proposed).toBe(1);
    expect(t.p.added).toHaveLength(1);
  });

  it('ok with no matching application proposes nothing', async () => {
    const t = build({ state: OLD, result: { status: 'ok', messages: [MESSAGE] }, apps: [] });
    const r = await checkMail(t.deps, { force: false });
    expect(r.proposed).toBe(0);
    expect(t.p.added).toHaveLength(0);
  });

  it('auth_expired and every unavailable reason map to their slugs', async () => {
    const auth = build({ state: OLD, result: { status: 'auth_expired' } });
    const a = await checkMail(auth.deps, { force: false });
    expect(runSlugFor(a.outcome)).toBe('permiso-caducado');
    expect(a.proposed).toBe(0);
    const expected = {
      network: 'sin-conexion',
      rate_limited: 'limite',
      server: 'servidor',
      bad_response: 'respuesta-rara',
    } as const;
    for (const [reason, slug] of Object.entries(expected)) {
      const t = build({
        state: OLD,
        result: { status: 'unavailable', reason: reason as keyof typeof expected },
      });
      expect(runSlugFor((await checkMail(t.deps, { force: false })).outcome)).toBe(slug);
    }
  });

  it('a throwing reader becomes failed and the detail stays out of the result', async () => {
    const t = build({ state: OLD, result: new Error('boom token=abc') });
    const r = await checkMail(t.deps, { force: false });
    expect(runSlugFor(r.outcome)).toBe('fallo');
    expect(JSON.stringify(r)).not.toContain('abc');
  });
});

describe('checkMail after a successful fetch that then fails', () => {
  const SECRET = 'secret-message-text C:\private\path';

  /** A proposal repository whose first N adds throw, then behaves. */
  function flaky(failures: number) {
    const base = proposalsRepo();
    let left = failures;
    const stored = new Map<string, unknown>();
    const repo = {
      ...(base.repo as object),
      findByMessageId: async (id: string) => stored.get(id) ?? null,
      add: async (draft: { messageId: string }) => {
        if (left > 0) {
          left -= 1;
          throw new Error(SECRET);
        }
        const existing = stored.get(draft.messageId);
        if (existing !== undefined) return { proposal: existing, created: false };
        stored.set(draft.messageId, draft);
        return { proposal: draft, created: true };
      },
    } as unknown as MailProposalRepository;
    return { repo, stored };
  }

  const OK = { status: 'ok', messages: [MESSAGE] } as const;

  it('restores lastSuccessAt, stays due, leaks nothing, and a retry creates the proposal once', async () => {
    const f = flaky(1);
    const t = build({ state: OLD, result: OK, proposals: f.repo });
    const failed = await checkMail(t.deps, { force: false });
    expect(failed.outcome).toEqual({ status: 'failed' });
    expect(failed.proposed).toBe(0);
    const after = t.s.get();
    expect(after.lastSuccessAt).toBe(OLD.lastSuccessAt);
    expect(after.lastError).toBe('unexpected');
    expect(isMailRunDue(NOW, new Date(after.lastSuccessAt as string))).toBe(true);
    expect(JSON.stringify([failed, after])).not.toMatch(/secret|private/);

    // The retry is a fresh run: make the cooldown irrelevant with force.
    const retry = await checkMail(t.deps, { force: true });
    expect(retry.outcome.status).toBe('ok');
    expect(retry.proposed).toBe(1);
    const again = await checkMail(t.deps, { force: true });
    expect(again.proposed).toBe(0);
    expect(f.stored.size).toBe(1);
  });

  it('keeps lastSuccessAt null after a failed first run', async () => {
    const f = flaky(1);
    const t = build({ state: EMPTY_MAIL_RUN_STATE, result: OK, proposals: f.repo });
    const failed = await checkMail(t.deps, { force: false });
    expect(failed.outcome).toEqual({ status: 'failed' });
    expect(t.s.get().lastSuccessAt).toBeNull();
    expect(isMailRunDue(NOW, null)).toBe(true);
  });

  it('still returns failed (and logs) when the restore itself throws', async () => {
    const f = flaky(1);
    const t = build({ state: OLD, result: OK, proposals: f.repo });
    const realUpdate = t.deps.store.update;
    let calls = 0;
    const store: MailRunStateStore = {
      ...t.deps.store,
      update: async (change) => {
        calls += 1;
        // 1st call: the run claims, 2nd: the run finishes, 3rd: our restore.
        if (calls >= 3) throw new Error(SECRET);
        return realUpdate(change);
      },
    };
    const out = await checkMail({ ...t.deps, store }, { force: false });
    expect(out.outcome).toEqual({ status: 'failed' });
    expect(JSON.stringify(out)).not.toMatch(/secret|private/);
    expect(t.logger.error).toHaveBeenCalled();
  });
});

describe('readMailStatus', () => {
  it('reports state without writing', async () => {
    const t = build({
      state: { ...OLD, lastAttemptAt: '2026-03-10T11:50:00.000Z', lastError: 'network' },
    });
    const s = await readMailStatus(t.deps);
    expect(s).toMatchObject({
      configured: true,
      tokenStatus: 'unknown',
      lastSuccessAt: OLD.lastSuccessAt,
      lastAttemptAt: '2026-03-10T11:50:00.000Z',
      lastError: 'network',
      pendingCount: 0,
      stateCorrupt: false,
    });
    expect(t.s.write).not.toHaveBeenCalled();
  });

  it('corrupt state gives safe defaults without leaking the path', async () => {
    const t = build({ state: 'corrupt' });
    const s = await readMailStatus(t.deps);
    expect(s.stateCorrupt).toBe(true);
    expect(s.lastError).toBeNull();
    expect(s.lastSuccessAt).toBeNull();
    expect(s.tokenStatus).toBe('unknown');
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('expired token surfaces', async () => {
    const t = build({ state: { ...OLD, authFailedAt: '2026-03-09T00:00:00.000Z' } });
    expect((await readMailStatus(t.deps)).tokenStatus).toBe('expired');
  });
});

describe('accept / dismiss', () => {
  const ACCEPTS: readonly AcceptMailProposalResult[] = [
    { status: 'accepted', historyEntryId: 'h' },
    { status: 'accepted_untracked', historyEntryId: null },
    { status: 'not_found' },
    { status: 'already_decided' },
    { status: 'application_not_found' },
    { status: 'conflict' },
    { status: 'refused', reason: 'invalid_value' } as unknown as AcceptMailProposalResult,
  ];
  const DISMISSES: readonly DismissMailProposalResult[] = [
    { status: 'dismissed' },
    { status: 'not_found' },
    { status: 'already_decided' },
  ];
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  it('accept passes every core status through', async () => {
    for (const result of ACCEPTS) {
      const out = await acceptMail('p1', {} as never, async () => result);
      expect(out).toEqual(result);
    }
  });

  it('dismiss passes every core status through', async () => {
    for (const result of DISMISSES) {
      expect(await dismissMail('p1', {} as never, async () => result)).toEqual(result);
    }
  });

  it('real core: an unknown proposal is not_found', async () => {
    const proposals = proposalsRepo().repo;
    const a = await acceptMail('nope', {
      proposals,
      applications: {},
      history: {},
      now: () => NOW,
    } as never);
    const d = await dismissMail('nope', { proposals });
    expect(a).toEqual({ status: 'not_found' });
    expect(d).toEqual({ status: 'not_found' });
  });

  it('a throwing repository never leaks its message', async () => {
    const proposals = {
      list: async () => {
        throw new Error(`disk ${SECRET_PATH}`);
      },
    };
    const log = logger();
    const a = await acceptMail('p1', {
      proposals,
      applications: {},
      history: {},
      now: () => NOW,
      logger: log,
    } as never);
    const d = await dismissMail('p1', { proposals, logger: log } as never);
    expect(a).toEqual({ status: 'failed' });
    expect(d).toEqual({ status: 'failed' });
    expect(JSON.stringify([a, d])).not.toContain('secret');
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(acceptSlugForResult(a)).toBe('rechazada');
    expect(dismissSlugForResult(d)).toBe('no-encontrada');
  });

  it('slugs delegate to the core mappers', () => {
    expect(acceptSlugForResult({ status: 'conflict' })).toBe('ya-aplicada');
    expect(dismissSlugForResult({ status: 'dismissed' })).toBe('descartada');
  });
});
