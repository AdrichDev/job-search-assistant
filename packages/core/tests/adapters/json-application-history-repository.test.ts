import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonApplicationHistoryRepository } from '../../src/adapters/persistence/json-application-history-repository.js';
import type { ApplicationChange } from '../../src/domain/application-history.js';
import type { ApplicationHistoryRepository } from '../../src/ports/application-history-repository.js';

const IMPORTED_ID = 'import-aaaa1111';
const LEGACY_ID = 'beta soluciones::qa júnior::barcelona';

function entry(id: string, jobId: string, at: string, extra: Partial<ApplicationChange> = {}): ApplicationChange {
  return {
    id,
    jobId,
    at: new Date(at),
    source: 'manual',
    changes: [{ field: 'notes', before: null, after: 'Nota ñandú' }],
    ...extra,
  };
}

let directory: string;
let filePath: string;
let history: ApplicationHistoryRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'app-history-'));
  filePath = join(directory, 'application-history.json');
  history = createJsonApplicationHistoryRepository({ filePath });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('createJsonApplicationHistoryRepository', () => {
  it('treats a missing file as an empty history and does not create it on read', async () => {
    expect(await history.listFor(IMPORTED_ID)).toEqual([]);
    expect(await history.find('x')).toBeNull();
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('appends, finds and revives dates and optional fields', async () => {
    await history.append(entry('a', IMPORTED_ID, '2026-04-01T10:00:00.000Z'));
    await history.append(
      entry('b', IMPORTED_ID, '2026-04-02T10:00:00.000Z', {
        source: 'revert',
        revertsId: 'a',
        changes: [{ field: 'sourceIds', before: ['infojobs'], after: [] }],
      }),
    );
    const found = await history.find('b');
    expect(found).toEqual(
      entry('b', IMPORTED_ID, '2026-04-02T10:00:00.000Z', {
        source: 'revert',
        revertsId: 'a',
        changes: [{ field: 'sourceIds', before: ['infojobs'], after: [] }],
      }),
    );
    expect(found?.at).toBeInstanceOf(Date);
    expect((await history.find('a'))?.revertsId).toBeUndefined();
    expect(await history.find('zzz')).toBeNull();
  });

  it('lists one application newest first and keeps others apart', async () => {
    await history.append(entry('a', IMPORTED_ID, '2026-04-01T10:00:00.000Z'));
    await history.append(entry('l', LEGACY_ID, '2026-04-03T10:00:00.000Z'));
    await history.append(entry('b', IMPORTED_ID, '2026-04-02T10:00:00.000Z'));
    await history.append(entry('c', IMPORTED_ID, '2026-04-02T10:00:00.000Z'));
    expect((await history.listFor(IMPORTED_ID)).map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect((await history.listFor(LEGACY_ID)).map((e) => e.id)).toEqual(['l']);
  });

  it('refuses a duplicate entry id and writes nothing', async () => {
    await history.append(entry('a', IMPORTED_ID, '2026-04-01T10:00:00.000Z'));
    const before = await readFile(filePath, 'utf8');
    await expect(history.append(entry('a', LEGACY_ID, '2026-04-02T10:00:00.000Z'))).rejects.toThrow(/already/i);
    expect(await readFile(filePath, 'utf8')).toBe(before);
  });

  it('serialises concurrent appends without losing any', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        history.append(entry(`e${index}`, IMPORTED_ID, `2026-04-01T10:00:${String(index).padStart(2, '0')}.000Z`)),
      ),
    );
    expect(await history.listFor(IMPORTED_ID)).toHaveLength(25);
    const stored = JSON.parse(await readFile(filePath, 'utf8')) as { version: number; changes: unknown[] };
    expect(stored.version).toBe(1);
    expect(stored.changes).toHaveLength(25);
  });

  it('keeps a 20,000 character note byte-exact', async () => {
    const long = 'Ñ'.repeat(20_000);
    await history.append(
      entry('long', IMPORTED_ID, '2026-04-01T10:00:00.000Z', {
        changes: [{ field: 'notes', before: long, after: null }],
      }),
    );
    const again = createJsonApplicationHistoryRepository({ filePath });
    expect((await again.find('long'))?.changes[0]).toEqual({ field: 'notes', before: long, after: null });
  });

  it.each([
    ['not JSON', '{ this is not json'],
    ['wrong version', JSON.stringify({ version: 2, changes: [] })],
    ['wrong shape', JSON.stringify({ version: 1, changes: [{ id: 'a' }] })],
    ['unknown source', JSON.stringify({ version: 1, changes: [{ id: 'a', jobId: 'j', at: '2026-04-01T10:00:00.000Z', source: 'robot', changes: [] }] })],
  ])('refuses a corrupt file (%s) and leaves it untouched', async (_label, content) => {
    await writeFile(filePath, content, 'utf8');
    await expect(history.listFor(IMPORTED_ID)).rejects.toThrow();
    await expect(history.append(entry('a', IMPORTED_ID, '2026-04-01T10:00:00.000Z'))).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(content);
  });
});
