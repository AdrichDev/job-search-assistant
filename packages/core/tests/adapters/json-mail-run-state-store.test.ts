import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonMailRunStateStore } from '../../src/adapters/persistence/json-mail-run-state-store.js';
import { EMPTY_MAIL_RUN_STATE, type MailRunState } from '../../src/ports/mail-run-state-store.js';

let directory: string;
let filePath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mail-run-'));
  filePath = join(directory, '.mail-run.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const sample: MailRunState = {
  lastSuccessAt: '2026-01-15T07:05:00.000Z',
  lastAttemptAt: '2026-01-15T07:05:00.000Z',
  lastError: null,
  tokenIssuedAt: '2026-01-10T10:00:00.000Z',
  authFailedAt: null,
};

describe('createJsonMailRunStateStore', () => {
  it('reads a missing file as the empty state without creating it', async () => {
    const store = createJsonMailRunStateStore({ filePath });
    expect(await store.read()).toEqual(EMPTY_MAIL_RUN_STATE);
    expect(await readdir(directory)).toEqual([]);
  });

  it('round-trips a written state', async () => {
    const store = createJsonMailRunStateStore({ filePath });
    await store.write(sample);
    expect(await createJsonMailRunStateStore({ filePath }).read()).toEqual(sample);
  });

  it('update merges into the current state', async () => {
    const store = createJsonMailRunStateStore({ filePath });
    await store.write(sample);
    const next = await store.update((current) => ({
      ...current,
      lastError: 'auth_expired',
      authFailedAt: '2026-01-16T07:00:00.000Z',
    }));
    expect(next.lastSuccessAt).toBe(sample.lastSuccessAt);
    expect(next.lastError).toBe('auth_expired');
    expect(await store.read()).toEqual(next);
  });

  it('serialises concurrent updates without losing any', async () => {
    const store = createJsonMailRunStateStore({ filePath });
    await Promise.all([
      store.update((c) => ({ ...c, lastAttemptAt: '2026-01-15T07:00:00.000Z' })),
      store.update((c) => ({ ...c, tokenIssuedAt: '2026-01-15T08:00:00.000Z' })),
    ]);
    const state = await store.read();
    expect(state.lastAttemptAt).toBe('2026-01-15T07:00:00.000Z');
    expect(state.tokenIssuedAt).toBe('2026-01-15T08:00:00.000Z');
  });

  it('leaves no temporary file behind after a write', async () => {
    const store = createJsonMailRunStateStore({ filePath });
    await store.write(sample);
    await store.update((c) => ({ ...c, lastError: 'network' }));
    expect(await readdir(directory)).toEqual(['.mail-run.json']);
  });

  it('parses a file written before runningSince existed', async () => {
    await writeFile(filePath, JSON.stringify({ version: 1, ...sample }), 'utf8');
    const state = await createJsonMailRunStateStore({ filePath }).read();
    expect(state).toEqual(sample);
    expect(state.runningSince ?? null).toBeNull();
  });

  it('round-trips runningSince, set and cleared', async () => {
    const store = createJsonMailRunStateStore({ filePath });
    const running = { ...sample, runningSince: '2026-01-16T07:00:00.000Z' };
    await store.write(running);
    expect(await createJsonMailRunStateStore({ filePath }).read()).toEqual(running);
    await store.update((c) => ({ ...c, runningSince: null }));
    expect((await store.read()).runningSince).toBeNull();
  });

  it('refuses an invalid runningSince and leaves the file byte-identical', async () => {
    const content = JSON.stringify({ ...sample, version: 1, runningSince: 'soon' });
    await writeFile(filePath, content, 'utf8');
    const store = createJsonMailRunStateStore({ filePath });
    await expect(store.read()).rejects.toThrow(/Refusing to overwrite/);
    await expect(store.update((c) => c)).rejects.toThrow(/Refusing to overwrite/);
    expect(await readFile(filePath, 'utf8')).toBe(content);
  });

  const corrupt: ReadonlyArray<readonly [string, string]> = [
    ['invalid JSON', '{not json'],
    ['a wrong shape', JSON.stringify({ version: 1, lastSuccessAt: 5 })],
    ['an invalid date', JSON.stringify({ ...sample, version: 1, lastSuccessAt: 'yesterday' })],
    ['a wrong version', JSON.stringify({ ...sample, version: 2 })],
  ];

  it.each(corrupt)('refuses %s and leaves the file byte-identical', async (_name, content) => {
    await writeFile(filePath, content, 'utf8');
    const store = createJsonMailRunStateStore({ filePath });

    await expect(store.read()).rejects.toThrow(/Refusing to overwrite/);
    await expect(store.write(sample)).rejects.toThrow(/Refusing to overwrite/);
    await expect(store.update((c) => c)).rejects.toThrow(/Refusing to overwrite/);

    expect(await readFile(filePath, 'utf8')).toBe(content);
    expect(await readdir(directory)).toEqual(['.mail-run.json']);
  });
});
