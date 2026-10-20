import { beforeEach, describe, expect, it } from 'vitest';
import { runMailCheck } from '../../src/app/run-mail-check.js';
import type { Logger } from '../../src/ports/logger.js';
import {
  EMPTY_MAIL_RUN_STATE,
  type MailRunState,
  type MailRunStateStore,
} from '../../src/ports/mail-run-state-store.js';
import type { MailMessage } from '../../src/ports/gmail-reader.js';
import { createFakeGmailReader, type FakeGmailReader } from '../helpers/fake-gmail-reader.js';

function memoryStore(initial: MailRunState = EMPTY_MAIL_RUN_STATE): MailRunStateStore & {
  current(): MailRunState;
} {
  let state = initial;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    current: () => state,
    read: async () => state,
    write: async (next) => {
      state = next;
    },
    update: (change) => {
      const run = queue.then(() => {
        state = change(state);
        return state;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => void lines.push(m),
    warn: (m) => void lines.push(m),
    error: (m) => void lines.push(m),
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 2026-03-11 10:00 Madrid (09:00Z): today's 08:00 run has already passed.
const NOW = new Date('2026-03-11T09:00:00.000Z');
const message: MailMessage = {
  id: 'm1',
  threadId: 't1',
  receivedAt: new Date('2026-03-11T06:00:00.000Z'),
  from: 'jobs@example.com',
  subject: 'Gracias por tu candidatura',
  snippet: 'hola',
};
// Before today's 08:00 Madrid, so a catch-up is due.
const due = '2026-03-10T09:00:00.000Z';

let reader: FakeGmailReader;

beforeEach(() => {
  reader = createFakeGmailReader();
});

describe('runMailCheck', () => {
  it('does not call the reader when not due', async () => {
    const store = memoryStore({ ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-11T07:30:00.000Z' });
    const result = await runMailCheck({ reader, store, now: () => NOW });
    expect(result).toEqual({ status: 'not_due' });
    expect(reader.calls).toHaveLength(0);
    expect(store.current().lastAttemptAt).toBeNull();
  });

  it('runs when not due but forced', async () => {
    const store = memoryStore({ ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: '2026-03-11T07:30:00.000Z' });
    const result = await runMailCheck({ reader, store, now: () => NOW }, { force: true });
    expect(result.status).toBe('ok');
    expect(reader.calls).toHaveLength(1);
  });

  it('is due on the first run and looks back 14 days', async () => {
    const store = memoryStore();
    const result = await runMailCheck({ reader, store, now: () => NOW });
    expect(result.status).toBe('ok');
    expect(reader.calls[0]!.since).toEqual(new Date(NOW.getTime() - 14 * DAY));
    expect(typeof reader.calls[0]!.maxResults).toBe('number');
  });

  it('looks back from the previous success minus 1 hour of overlap', async () => {
    const store = memoryStore({ ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: due });
    await runMailCheck({ reader, store, now: () => NOW });
    expect(reader.calls[0]!.since).toEqual(new Date(new Date(due).getTime() - HOUR));
  });

  it('on ok: records success, clears errors and the marker, returns messages', async () => {
    reader.script({ status: 'ok', messages: [message] });
    const store = memoryStore({
      ...EMPTY_MAIL_RUN_STATE,
      lastSuccessAt: due,
      lastError: 'network',
      authFailedAt: '2026-03-01T00:00:00.000Z',
      tokenIssuedAt: '2026-03-05T00:00:00.000Z',
    });
    const result = await runMailCheck({ reader, store, now: () => NOW });
    expect(result).toEqual({ status: 'ok', messages: [message] });
    expect(store.current()).toMatchObject({
      lastSuccessAt: NOW.toISOString(),
      lastAttemptAt: NOW.toISOString(),
      lastError: null,
      authFailedAt: null,
      tokenIssuedAt: '2026-03-05T00:00:00.000Z',
      runningSince: null,
    });
  });

  it('records lastAttemptAt and the marker while the reader is pending', async () => {
    reader.hold();
    const store = memoryStore();
    const pending = runMailCheck({ reader, store, now: () => NOW });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.current().lastAttemptAt).toBe(NOW.toISOString());
    expect(store.current().runningSince).toBe(NOW.toISOString());
    reader.release();
    await pending;
  });

  it('on auth_expired: flags auth, keeps lastSuccessAt, clears the marker', async () => {
    reader.script({ status: 'auth_expired' });
    const store = memoryStore({ ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: due });
    const result = await runMailCheck({ reader, store, now: () => NOW });
    expect(result).toEqual({ status: 'auth_expired' });
    expect(store.current()).toMatchObject({
      lastSuccessAt: due,
      authFailedAt: NOW.toISOString(),
      lastError: 'auth_expired',
      runningSince: null,
    });
  });

  it.each(['network', 'rate_limited', 'server', 'bad_response'] as const)(
    'on unavailable (%s): records the reason and keeps the catch-up due',
    async (reason) => {
      reader.script({ status: 'unavailable', reason });
      const store = memoryStore({ ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: due });
      const result = await runMailCheck({ reader, store, now: () => NOW });
      expect(result).toEqual({ status: 'unavailable', reason });
      expect(store.current()).toMatchObject({
        lastSuccessAt: due,
        lastError: reason,
        authFailedAt: null,
        runningSince: null,
      });
    },
  );

  it('on an unexpected throw: clears the marker, keeps detail in the logger only', async () => {
    reader.script(new Error('ECONNRESET at some-local-path boom'));
    const store = memoryStore({ ...EMPTY_MAIL_RUN_STATE, lastSuccessAt: due });
    const logger = recordingLogger();
    const result = await runMailCheck({ reader, store, now: () => NOW, logger });
    expect(result).toEqual({ status: 'failed' });
    expect(store.current().runningSince).toBeNull();
    expect(store.current().lastError).toBe('unexpected');
    expect(store.current().lastSuccessAt).toBe(due);
    expect(JSON.stringify(store.current())).not.toContain('boom');
    expect(JSON.stringify(result)).not.toContain('boom');
    expect(logger.lines.join('\n')).toContain('boom');
    // The next run is not locked out.
    reader.script({ status: 'ok', messages: [] });
    expect((await runMailCheck({ reader, store, now: () => NOW })).status).toBe('ok');
  });

  it('refuses a concurrent second call while the first is pending', async () => {
    reader.hold();
    const store = memoryStore();
    const first = runMailCheck({ reader, store, now: () => NOW });
    while (reader.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const second = await runMailCheck({ reader, store, now: () => NOW }, { force: true });
    expect(second).toEqual({ status: 'already_running' });
    expect(reader.calls).toHaveLength(1);
    reader.release();
    expect((await first).status).toBe('ok');
    expect(store.current().runningSince).toBeNull();
  });

  it('refuses when another process left a fresh marker', async () => {
    const recent = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const store = memoryStore({
      ...EMPTY_MAIL_RUN_STATE,
      lastAttemptAt: recent,
      runningSince: recent,
    });
    expect(await runMailCheck({ reader, store, now: () => NOW })).toEqual({
      status: 'already_running',
    });
    expect(reader.calls).toHaveLength(0);
  });

  it('takes over a stale marker', async () => {
    const old = new Date(NOW.getTime() - 16 * 60_000).toISOString();
    const store = memoryStore({ ...EMPTY_MAIL_RUN_STATE, lastAttemptAt: old, runningSince: old });
    const result = await runMailCheck({ reader, store, now: () => NOW });
    expect(result.status).toBe('ok');
    expect(store.current().runningSince).toBeNull();
  });

  it('honours a custom stale window', async () => {
    const recent = new Date(NOW.getTime() - 2 * 60_000).toISOString();
    const store = memoryStore({
      ...EMPTY_MAIL_RUN_STATE,
      lastAttemptAt: recent,
      runningSince: recent,
    });
    const result = await runMailCheck({ reader, store, now: () => NOW }, { staleAfterMs: 60_000 });
    expect(result.status).toBe('ok');
  });

  it('treats a state from an older file without runningSince as not running', async () => {
    const legacy: MailRunState = {
      lastSuccessAt: null,
      lastAttemptAt: new Date(NOW.getTime() - 60_000).toISOString(),
      lastError: null,
      tokenIssuedAt: null,
      authFailedAt: null,
    };
    expect('runningSince' in legacy).toBe(false);
    const store = memoryStore(legacy);
    expect((await runMailCheck({ reader, store, now: () => NOW })).status).toBe('ok');
  });
});
