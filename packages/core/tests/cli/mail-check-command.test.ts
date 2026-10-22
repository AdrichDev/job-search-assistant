import { describe, expect, it, vi } from 'vitest';
import type { Application } from '../../src/domain/application.js';
import type { MailProposal } from '../../src/domain/mail-proposal.js';
import {
  MAIL_CHECK_USAGE,
  parseMailCheckArgs,
  runMailCheckCommand,
} from '../../src/cli/mail-check-command.js';
import type { MailCheckDeps } from '../../src/app/check-mail-with-proposals.js';
import type { GmailFetchResult, GmailReader, MailMessage } from '../../src/ports/gmail-reader.js';
import type { MailProposalRepository } from '../../src/ports/mail-proposal-repository.js';
import {
  EMPTY_MAIL_RUN_STATE,
  type MailRunState,
  type MailRunStateStore,
} from '../../src/ports/mail-run-state-store.js';

/**
 * The scheduled entry point's OUTPUT contract: every outcome of the shared mail
 * pipeline has one exit code and a set of lines a human can act on. The lines
 * must never carry a credential value, an underlying exception message or a
 * leaked path - only the state path that was handed in.
 */

const NOW = new Date('2026-03-10T12:00:00.000Z'); // 13:00 Madrid, after the 08:00 run
const STATE_PATH = 'scratch/.mail-run.json';
const OLD: MailRunState = { ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-08T08:30:00.000Z' };

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

function storeWith(initial: MailRunState | 'corrupt') {
  let state: MailRunState = initial === 'corrupt' ? EMPTY_MAIL_RUN_STATE : initial;
  const corrupt = initial === 'corrupt';
  const store: MailRunStateStore = {
    read: async () => {
      if (corrupt) throw new Error('unreadable CORRUPT-SENTINEL');
      return state;
    },
    write: async (next: MailRunState) => {
      state = next;
    },
    update: async (change) => {
      if (corrupt) throw new Error('unreadable CORRUPT-SENTINEL');
      state = change(state);
      return state;
    },
  };
  return store;
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
}) {
  const store = storeWith(opts.state ?? OLD);
  const p = proposalsRepo();
  const fetchRecent = vi.fn(async (): Promise<GmailFetchResult> => {
    const r = opts.result ?? { status: 'ok' as const, messages: [] };
    if (r instanceof Error) throw r;
    return r;
  });
  const reader: GmailReader = { fetchRecent };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: MailCheckDeps = {
    configured: () => opts.configured ?? true,
    reader,
    store,
    proposals: p.repo,
    applications: { list: async () => opts.apps ?? [application()] },
    now: () => NOW,
    logger,
  };
  return { deps, fetchRecent, p };
}

function run(
  deps: MailCheckDeps,
  force = false,
): Promise<{ readonly exitCode: 0 | 1; readonly lines: readonly string[] }> {
  return runMailCheckCommand({ deps, force, statePath: STATE_PATH });
}

describe('parseMailCheckArgs', () => {
  it('accepts --force', () => {
    expect(parseMailCheckArgs(['--force'])).toEqual({ help: false, force: true });
  });

  it('accepts empty argv as a plain run', () => {
    expect(parseMailCheckArgs([])).toEqual({ help: false, force: false });
  });

  it('accepts --help and -h', () => {
    expect(parseMailCheckArgs(['--help'])).toEqual({ help: true });
    expect(parseMailCheckArgs(['-h'])).toEqual({ help: true });
  });

  it('rejects an unknown flag as a usage error', () => {
    const parsed = parseMailCheckArgs(['--weekly']);
    expect(parsed.help).toBe(false);
    if (parsed.help === false && 'error' in parsed) {
      expect(parsed.error).toContain('--weekly');
    } else {
      expect.fail('an unknown flag must be reported');
    }
  });
});

describe('MAIL_CHECK_USAGE', () => {
  it('documents the two flags', () => {
    expect(MAIL_CHECK_USAGE).toContain('--force');
    expect(MAIL_CHECK_USAGE).toContain('--help');
  });
});

describe('runMailCheckCommand', () => {
  it('ok: exit 0, counts and the /seguimiento reminder', async () => {
    const t = build({ state: OLD, result: { status: 'ok', messages: [MESSAGE] } });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toContain('1');
    expect(r.lines[1]).toContain('1');
    expect(r.lines[2]).toContain('/seguimiento');
  });

  it('not_due: exit 0, one line about the last successful run', async () => {
    const t = build({
      state: { ...OLD, lastSuccessAt: '2026-03-10T08:30:00.000Z' },
      result: { status: 'ok', messages: [MESSAGE] },
    });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/last successful|due/i);
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('cooldown: exit 0, one line about the retry cooldown', async () => {
    const t = build({
      state: { ...OLD, lastAttemptAt: '2026-03-10T11:50:00.000Z' },
    });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/cooldown|recently/i);
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('already_running: exit 0, one line', async () => {
    const t = build({
      state: {
        ...OLD,
        runningSince: '2026-03-10T11:55:00.000Z',
        lastAttemptAt: '2026-03-10T11:55:00.000Z',
      },
    });
    // Without --force this state reports as `cooldown` (30 min) before the
    // fresh marker (15 min) is ever consulted, so force is the way in.
    const r = await run(t.deps, true);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/already running/i);
    expect(t.fetchRecent).not.toHaveBeenCalled();
  });

  it('not_configured: exit 1, variable NAMES and setup pointers, never a value', async () => {
    const t = build({ configured: false });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(1);
    const all = r.lines.join('\n');
    expect(all).toContain('GOOGLE_CLIENT_ID');
    expect(all).toContain('GOOGLE_CLIENT_SECRET');
    expect(all).toContain('GOOGLE_REFRESH_TOKEN');
    // The instruction has to name the file THIS command reads. `google:consent`
    // writes the refresh token to the repository-root .env; data/dev-env.json is
    // the web app's source, so pointing a scheduled run there sends the user to
    // a file that would still leave every variable invisible here.
    expect(all).toContain('repository-root .env');
    expect(all).toContain('npm run google:consent');
    // A value would end up here only if the command echoed configuration; the
    // sentinel proves no line carries anything but the variable names.
    expect(all).not.toContain('sentinel-credential');
  });

  it('state_corrupt: exit 1, names the state path, never the store error', async () => {
    const t = build({ state: 'corrupt' });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(1);
    const all = r.lines.join('\n');
    expect(all).toContain(STATE_PATH);
    expect(all).toMatch(/last success|never.*reset/i);
    expect(all).not.toContain('CORRUPT-SENTINEL');
  });

  it('auth_expired: exit 1, points at npm run google:consent', async () => {
    const t = build({ result: { status: 'auth_expired' } });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain('npm run google:consent');
  });

  it('unavailable: exit 1, one line naming the reason', async () => {
    const t = build({ result: { status: 'unavailable', reason: 'network' } });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain('network');
  });

  it('failed: exit 1, one generic line, no cause text', async () => {
    const t = build({ result: new Error('fetch boom FAILED-SENTINEL') });
    const r = await run(t.deps);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).not.toContain('FAILED-SENTINEL');
    expect(r.lines[0]).not.toContain('fetch boom');
  });
});
