import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJsonApplicationHistoryRepository,
  createJsonApplicationRepository,
  type ApplicationHistoryRepository,
  type ApplicationRepository,
} from '@job-queue/core';
import { ACTION_MESSAGES } from '@/copy/action-messages';
import { translateActionMessage } from '@/copy/es';
import { editApplication, revertChange, type WriteDeps } from '@/server/use-cases';

/**
 * Edit + history + undo through the REAL JSON repositories on temp files, with a
 * log shaped like the real one (imported row: listing, no cvVariant/score;
 * legacy queue-made row: no listing, 3-part id, no sourceIds).
 */

const NOW = new Date('2026-09-07T12:00:00.000Z');
const IMPORTED_ID = 'import-aaaa1111';
const LEGACY_ID = 'beta soluciones::qa júnior::barcelona';

const SEED = {
  version: 1,
  applications: [
    {
      jobId: IMPORTED_ID,
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      outcomeUpdatedAt: '2026-03-01T00:00:00.000Z',
      notes: 'Ñ'.repeat(3000),
      listing: {
        company: 'Información Ñandú S.L.',
        title: 'Desarrollador Júnior Frontend',
        url: 'https://empleo.example.test/oferta/1',
        portal: 'InfoJobs',
        city: 'Alcobendas',
      },
    },
    {
      jobId: LEGACY_ID,
      appliedAt: '2026-02-10T12:34:56.000Z',
      cvVariant: 'general',
      scoreAtApply: 61,
      sourceIds: [],
      outcome: 'screening',
      outcomeUpdatedAt: '2026-02-15T12:34:56.000Z',
    },
  ],
};

let directory: string;
let filePath: string;
let historyPath: string;
let repository: ApplicationRepository;
let history: ApplicationHistoryRepository;
let deps: WriteDeps;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'revert-change-'));
  filePath = join(directory, 'applications.json');
  historyPath = join(directory, 'application-history.json');
  await writeFile(filePath, `${JSON.stringify(SEED, null, 2)}\n`, 'utf8');
  repository = createJsonApplicationRepository({ filePath });
  history = createJsonApplicationHistoryRepository({ filePath: historyPath });
  let tick = 0;
  deps = {
    applicationRepository: repository,
    historyRepository: history,
    loadQueue: async () => null,
    now: () => new Date(NOW.getTime() + 1000 * tick++),
  };
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

const applicationsBytes = () => readFile(filePath, 'utf8');

describe('editApplication records the change history', () => {
  it('logs exactly one manual entry for a real edit', async () => {
    const result = await editApplication(
      form({ jobId: IMPORTED_ID, outcome: 'rejected', notes: 'Rechazo por correo' }),
      deps,
    );
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEdited });
    const entries = await history.listFor(IMPORTED_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe('manual');
    expect(entries[0]?.changes.map((change) => change.field)).toEqual(['outcome', 'outcomeUpdatedAt', 'notes']);
  });

  it('logs nothing for an untouched form, a refused edit or an unknown job', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, notes: 'Ñ'.repeat(3000) }), deps);
    await editApplication(form({ jobId: IMPORTED_ID, url: 'javascript:alert(1)' }), deps);
    await editApplication(form({ jobId: 'nope', notes: 'x' }), deps);
    await expect(readFile(historyPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the edit and warns, in a fixed message, when the history cannot be written', async () => {
    await writeFile(historyPath, '{ not json', 'utf8');
    const result = await editApplication(form({ jobId: IMPORTED_ID, notes: 'guardada igualmente' }), deps);
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEditedNotLogged });
    expect((await repository.findByJobId(IMPORTED_ID))?.notes).toBe('guardada igualmente');
    expect(await readFile(historyPath, 'utf8')).toBe('{ not json');
    expect(translateActionMessage(result.message)).toMatch(/no se pudo anotar|historial/i);
  });

  it('does not warn when no history store is configured', async () => {
    const { historyRepository: _omit, ...withoutHistory } = deps;
    const result = await editApplication(form({ jobId: IMPORTED_ID, notes: 'x' }), withoutHistory);
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEdited });
  });
});

describe('revertChange - input validation (everything arrives as unknown)', () => {
  it.each([null, undefined, 'entryId=x', 42, {}, [], Symbol('x')])(
    'refuses a non-FormData input %s',
    async (input) => {
      const before = await applicationsBytes();
      const result = await revertChange(input, deps);
      expect(result).toMatchObject({ ok: false, message: ACTION_MESSAGES.invalidInput, code: 'invalido' });
      expect(await applicationsBytes()).toBe(before);
    },
  );

  it('refuses a missing, blank or file-valued entry id', async () => {
    expect(await revertChange(form({}), deps)).toMatchObject({ ok: false, code: 'invalido' });
    expect(await revertChange(form({ entryId: '   ' }), deps)).toMatchObject({ ok: false, code: 'invalido' });
    const data = new FormData();
    data.append('entryId', new File(['x'], 'id.txt'));
    expect(await revertChange(data, deps)).toMatchObject({ ok: false, code: 'invalido' });
  });

  it('refuses when no history store is configured', async () => {
    const { historyRepository: _omit, ...withoutHistory } = deps;
    expect(await revertChange(form({ entryId: 'x' }), withoutHistory)).toMatchObject({
      ok: false,
      message: ACTION_MESSAGES.historyUnavailable,
    });
  });
});

describe('revertChange', () => {
  async function editAndGetEntryId(fields: Record<string, string>, jobId = IMPORTED_ID): Promise<string> {
    await editApplication(form({ jobId, ...fields }), deps);
    const entries = await history.listFor(jobId);
    return entries[0]?.id as string;
  }

  it('undoes the latest change, restores the stored file byte-for-byte and logs the undo', async () => {
    const before = await applicationsBytes();
    const entryId = await editAndGetEntryId({ outcome: 'rejected', notes: 'otra nota', city: '' });
    expect(await applicationsBytes()).not.toBe(before);

    const result = await revertChange(form({ entryId }), deps);
    expect(result).toEqual({
      ok: true,
      message: ACTION_MESSAGES.changeReverted,
      code: 'deshecho',
      jobId: IMPORTED_ID,
    });
    expect(await applicationsBytes()).toBe(before);
    const entries = await history.listFor(IMPORTED_ID);
    expect(entries.map((entry) => entry.source)).toEqual(['revert', 'manual']);
    expect(entries[0]?.revertsId).toBe(entryId);
  });

  it('undoes an edit of a legacy row', async () => {
    const before = await applicationsBytes();
    const entryId = await editAndGetEntryId({ outcome: 'rejected' }, LEGACY_ID);
    await revertChange(form({ entryId }), deps);
    expect(await applicationsBytes()).toBe(before);
  });

  it('answers each status with its own message and changes nothing on a refusal', async () => {
    const first = await editAndGetEntryId({ notes: 'uno' });
    const second = await editAndGetEntryId({ notes: 'dos' });

    expect(await revertChange(form({ entryId: 'no-existe' }), deps)).toMatchObject({
      ok: false,
      message: ACTION_MESSAGES.changeNotFound,
      code: 'no-encontrado',
      jobId: null,
    });
    expect(await revertChange(form({ entryId: first }), deps)).toMatchObject({
      ok: false,
      message: ACTION_MESSAGES.changeNotLatest,
      code: 'no-ultimo',
    });
    expect((await repository.findByJobId(IMPORTED_ID))?.notes).toBe('dos');

    await revertChange(form({ entryId: second }), deps);
    expect(await revertChange(form({ entryId: second }), deps)).toMatchObject({
      ok: false,
      message: ACTION_MESSAGES.changeAlreadyReverted,
      code: 'ya-deshecho',
    });
    // The older entry is undoable only now.
    expect(await revertChange(form({ entryId: first }), deps)).toMatchObject({ ok: true, code: 'deshecho' });
  });

  it('reports a conflict, with its own message, when the log file was changed outside the history', async () => {
    const entryId = await editAndGetEntryId({ notes: 'dentro del historial' });
    const stored = JSON.parse(await applicationsBytes()) as typeof SEED;
    const imported = stored.applications[0];
    if (imported === undefined) throw new Error('seed');
    imported.notes = 'cambiada a mano fuera de la app';
    await writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    const after = await applicationsBytes();
    const historyBefore = await readFile(historyPath, 'utf8');
    const result = await revertChange(form({ entryId }), deps);
    expect(result).toMatchObject({ ok: false, message: ACTION_MESSAGES.changeConflict, code: 'conflicto' });
    expect(await applicationsBytes()).toBe(after);
    expect(await readFile(historyPath, 'utf8')).toBe(historyBefore);
  });

  it('every revert message has Spanish copy', () => {
    for (const message of [
      ACTION_MESSAGES.changeReverted,
      ACTION_MESSAGES.changeRevertedNotLogged,
      ACTION_MESSAGES.changeNotFound,
      ACTION_MESSAGES.changeAlreadyReverted,
      ACTION_MESSAGES.changeNotLatest,
      ACTION_MESSAGES.changeConflict,
      ACTION_MESSAGES.historyUnavailable,
      ACTION_MESSAGES.applicationEditedNotLogged,
    ]) {
      expect(translateActionMessage(message), message).not.toBe(message);
    }
  });
});
