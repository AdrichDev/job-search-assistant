import { describe, expect, it, vi } from 'vitest';
import type { Application } from '../../src/domain/application.js';
import type { GmailFetchResult, GmailReader, MailMessage } from '../../src/ports/gmail-reader.js';
import type { MailProposal } from '../../src/domain/mail-proposal.js';
import type { MailProposalRepository } from '../../src/ports/mail-proposal-repository.js';
import {
  EMPTY_MAIL_RUN_STATE,
  type MailRunState,
  type MailRunStateStore,
} from '../../src/ports/mail-run-state-store.js';
import {
  checkMailWithProposals,
  type MailCheckDeps,
} from '../../src/app/check-mail-with-proposals.js';

/**
 * The mail check that the web app and the `mail:check` CLI both use. The gates
 * and the order they run in are the whole point of this module, so each gate
 * has a test that also proves the NO-write / NO-network promise.
 */

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

function proposalsRepo(options: { readonly failing?: boolean } = {}) {
  const added: unknown[] = [];
  const repo = {
    list: async () => [] as readonly MailProposal[],
    listPending: async () => [] as readonly MailProposal[],
    findByMessageId: async () => null,
    add: vi.fn(async (draft: unknown) => {
      if (options.failing === true) {
        throw new Error('proposals unavailable');
      }
      added.push(draft);
      return { proposal: draft as MailProposal, created: true };
    }),
  } as unknown as MailProposalRepository;
  return { repo, added };
}

const RECENT_OK: MailRunState = { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-10T08:30:00.000Z' };
const OLD: MailRunState = { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-08T08:30:00.000Z' };

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

describe('checkMailWithProposals', () => {
  it('not configured writes nothing and never reads', async () => {
    const t = build({ configured: false });
    const r = await checkMailWithProposals(t.deps, { force: true });
    expect(r.outcome).toEqual({ status: 'not_configured' });
    expect(r.proposed).toBe(0);
    expect(t.s.write).not.toHaveBeenCalled();
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('corrupt state returns state_corrupt without throwing or leaking', async () => {
    const t = build({ state: 'corrupt' });
    const r = await checkMailWithProposals(t.deps, { force: true });
    expect(r.outcome).toEqual({ status: 'state_corrupt' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(t.fetchRecent).not.toHaveBeenCalled();
    expect(t.s.write).not.toHaveBeenCalled();
  });

  it('not due when the last success is after the most recent 08:00', async () => {
    const t = build({ state: RECENT_OK });
    expect((await checkMailWithProposals(t.deps, { force: false })).outcome).toEqual({
      status: 'not_due',
    });
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('cooldown after a failed attempt 10 minutes ago', async () => {
    const t = build({ state: { ...OLD, lastAttemptAt: '2026-03-10T11:50:00.000Z' } });
    expect((await checkMailWithProposals(t.deps, { force: false })).outcome).toEqual({
      status: 'cooldown',
    });
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('force bypasses cooldown and not_due', async () => {
    const cooling = build({ state: { ...OLD, lastAttemptAt: '2026-03-10T11:50:00.000Z' } });
    expect((await checkMailWithProposals(cooling.deps, { force: true })).outcome.status).toBe('ok');
    const fresh = build({ state: RECENT_OK });
    expect((await checkMailWithProposals(fresh.deps, { force: true })).outcome.status).toBe('ok');
    expect(fresh.fetchRecent).toHaveBeenCalledTimes(1);
  });

  it('ok creates proposals through the matcher and returns the count', async () => {
    const t = build({ state: OLD, result: { status: 'ok', messages: [MESSAGE] } });
    const r = await checkMailWithProposals(t.deps, { force: false });
    expect(r.outcome.status).toBe('ok');
    expect(r.proposed).toBe(1);
    expect(t.p.added).toHaveLength(1);
  });

  it('ok with no matching application proposes nothing', async () => {
    const t = build({ state: OLD, result: { status: 'ok', messages: [MESSAGE] }, apps: [] });
    const r = await checkMailWithProposals(t.deps, { force: false });
    expect(r.outcome.status).toBe('ok');
    expect(r.proposed).toBe(0);
  });

  it('auth_expired and unavailable are passed through with no proposals', async () => {
    const expired = build({ state: OLD, result: { status: 'auth_expired' } });
    expect((await checkMailWithProposals(expired.deps, { force: false })).outcome).toEqual({
      status: 'auth_expired',
    });
    expect(expired.p.added).toHaveLength(0);

    const offline = build({ state: OLD, result: { status: 'unavailable', reason: 'network' } });
    expect((await checkMailWithProposals(offline.deps, { force: false })).outcome).toEqual({
      status: 'unavailable',
      reason: 'network',
    });
  });

  it('reports failed when the reader throws, and keeps the state writable', async () => {
    const t = build({ state: OLD, result: new Error('boom') });
    const r = await checkMailWithProposals(t.deps, { force: false });
    expect(r.outcome).toEqual({ status: 'failed' });
    expect(t.s.get().runningSince).toBeNull();
    expect(t.s.get().lastSuccessAt).toBe(OLD.lastSuccessAt);
    expect(t.logger.error).toHaveBeenCalled();
  });

  /*
   * The mark is advanced by the fetch, before the mails become proposals. A
   * failure in between must put the previous mark back, otherwise the next run
   * only looks back one hour and a reply received in that gap is never proposed.
   */
  it('restores lastSuccessAt when proposal creation fails after a successful fetch', async () => {
    const failing = proposalsRepo({ failing: true });
    const t = build({
      state: OLD,
      result: { status: 'ok', messages: [MESSAGE] },
      proposals: failing.repo,
    });
    const r = await checkMailWithProposals(t.deps, { force: false });
    expect(r.outcome).toEqual({ status: 'failed' });
    expect(t.s.get().lastSuccessAt).toBe(OLD.lastSuccessAt);
    expect(t.s.get().lastError).toBe('unexpected');
  });

  it('restores a null mark on a first run whose proposals fail', async () => {
    const failing = proposalsRepo({ failing: true });
    const t = build({
      state: EMPTY_MAIL_RUN_STATE,
      result: { status: 'ok', messages: [MESSAGE] },
      proposals: failing.repo,
    });
    expect((await checkMailWithProposals(t.deps, { force: true })).outcome).toEqual({
      status: 'failed',
    });
    expect(t.s.get().lastSuccessAt).toBeNull();
  });
});
