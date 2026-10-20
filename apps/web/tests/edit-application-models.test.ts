import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJsonApplicationHistoryRepository,
  createJsonApplicationRepository,
  createJsonCvModelRepository,
  type ApplicationRepository,
  type CvModelRepository,
} from '@job-queue/core';
import { ACTION_MESSAGES } from '@/copy/action-messages';
import { editApplication, revertChange, type WriteDeps } from '@/server/use-cases';

/**
 * Marking the CV / letter model used on an application (T3b), through the REAL
 * JSON repositories on temp files, with fixtures shaped like the real log.
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
let repository: ApplicationRepository;
let models: CvModelRepository;
let deps: WriteDeps;
let cvId: string;
let cvId2: string;
let letterId: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'edit-models-'));
  filePath = join(directory, 'applications.json');
  await writeFile(filePath, `${JSON.stringify(SEED, null, 2)}\n`, 'utf8');
  repository = createJsonApplicationRepository({ filePath });
  models = createJsonCvModelRepository({ filePath: join(directory, 'cv-models.json') });
  const add = async (name: string, kind: 'cv' | 'letter', path: string) => {
    const result = await models.add({ name, kind, language: 'es', tags: [], relativePath: path });
    if (result.status !== 'added') throw new Error('seed');
    return result.model.id;
  };
  cvId = await add('CV Desarrollador Ñ', 'cv', 'cv-uno.pdf');
  cvId2 = await add('CV Frontend', 'cv', 'cv-dos.pdf');
  letterId = await add('Carta Base', 'letter', 'carta.pdf');
  deps = {
    applicationRepository: repository,
    cvModelRepository: models,
    loadQueue: async () => null,
    now: () => NOW,
  };
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const bytes = () => readFile(filePath, 'utf8');
const stored = async (jobId: string) => repository.findByJobId(jobId);

/** What the real form posts for an untouched legacy record, plus the model selects. */
const LEGACY_UNTOUCHED = {
  jobId: LEGACY_ID,
  appliedAt: '2026-02-10',
  outcome: 'screening',
  outcomeUpdatedAt: '2026-02-15',
  cvVariant: 'general',
  notes: '',
  sourceIds: '',
  company: 'beta soluciones',
  title: 'qa júnior',
  url: '',
  portal: '',
  city: 'barcelona',
  address: '',
  phone: '',
  contact: '',
  companyInfo: '',
  publishedAt: '',
};

describe('editApplication - model references', () => {
  it('marks a CV model and a letter model and keeps the legacy variant', async () => {
    const result = await editApplication(
      form({ ...LEGACY_UNTOUCHED, cvModelId: cvId, letterModelId: letterId }),
      deps,
    );
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEdited });
    const app = await stored(LEGACY_ID);
    expect(app).toMatchObject({ cvModelId: cvId, letterModelId: letterId, cvVariant: 'general' });
  });

  it('an unchanged pre-filled form is "unchanged" and the file stays byte-identical', async () => {
    const before = await bytes();
    const result = await editApplication(form({ ...LEGACY_UNTOUCHED, cvModelId: '', letterModelId: '' }), deps);
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
    expect(await bytes()).toBe(before);
  });

  it('re-posting the stored ids unchanged is a no-op', async () => {
    await editApplication(form({ ...LEGACY_UNTOUCHED, cvModelId: cvId, letterModelId: letterId }), deps);
    const before = await bytes();
    const result = await editApplication(
      form({ ...LEGACY_UNTOUCHED, cvModelId: cvId, letterModelId: letterId }),
      deps,
    );
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
    expect(await bytes()).toBe(before);
  });

  it('changes and clears a model', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: cvId }), deps);
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: cvId2 }), deps);
    expect((await stored(IMPORTED_ID))?.cvModelId).toBe(cvId2);
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: '' }), deps);
    expect(await bytes()).not.toContain('cvModelId');
  });

  it('refuses an unknown id with a Spanish-mapped message and writes nothing', async () => {
    const before = await bytes();
    const cv = await editApplication(form({ jobId: IMPORTED_ID, cvModelId: 'tampered-id' }), deps);
    expect(cv).toEqual({ ok: false, message: ACTION_MESSAGES.unknownCvModel });
    const letter = await editApplication(form({ jobId: IMPORTED_ID, letterModelId: 'tampered-id' }), deps);
    expect(letter).toEqual({ ok: false, message: ACTION_MESSAGES.unknownLetterModel });
    expect(await bytes()).toBe(before);
  });

  it('refuses a model of the wrong kind with a distinct message', async () => {
    const before = await bytes();
    const cvWithLetter = await editApplication(form({ jobId: IMPORTED_ID, cvModelId: letterId }), deps);
    expect(cvWithLetter).toEqual({ ok: false, message: ACTION_MESSAGES.notACvModel });
    const letterWithCv = await editApplication(form({ jobId: IMPORTED_ID, letterModelId: cvId }), deps);
    expect(letterWithCv).toEqual({ ok: false, message: ACTION_MESSAGES.notALetterModel });
    expect(ACTION_MESSAGES.notACvModel).not.toBe(ACTION_MESSAGES.unknownCvModel);
    expect(await bytes()).toBe(before);
  });

  it('refuses an over-long id as too long, before any lookup', async () => {
    const result = await editApplication(form({ jobId: IMPORTED_ID, cvModelId: 'x'.repeat(81) }), deps);
    expect(result).toEqual({ ok: false, message: ACTION_MESSAGES.tooLong });
  });

  it('a whitespace-only id clears like an empty one', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: cvId }), deps);
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: '   ' }), deps);
    expect(await bytes()).not.toContain('cvModelId');
  });

  it('keeps a dangling stored id across an unrelated edit and never re-validates it', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: cvId, letterModelId: letterId }), deps);
    await models.remove(cvId);
    await models.remove(letterId);
    const result = await editApplication(
      form({ jobId: IMPORTED_ID, notes: 'nota nueva', cvModelId: cvId, letterModelId: letterId }),
      deps,
    );
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEdited });
    expect(await stored(IMPORTED_ID)).toMatchObject({ cvModelId: cvId, letterModelId: letterId, notes: 'nota nueva' });
  });

  it('a dangling id can still be replaced by a registered one or cleared', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: cvId }), deps);
    await models.remove(cvId);
    await editApplication(form({ jobId: IMPORTED_ID, cvModelId: cvId2 }), deps);
    expect((await stored(IMPORTED_ID))?.cvModelId).toBe(cvId2);
  });

  it('degrades a registry read failure to a message without raw text or paths', async () => {
    const broken: CvModelRepository = {
      ...models,
      find: async () => {
        throw new Error('EACCES: permission denied, open D:\\secret\\cv-models.json');
      },
    };
    const before = await bytes();
    const result = await editApplication(
      form({ jobId: IMPORTED_ID, cvModelId: cvId }),
      { ...deps, cvModelRepository: broken },
    );
    expect(result).toEqual({ ok: false, message: ACTION_MESSAGES.modelRegistryUnavailable });
    expect(result.message).not.toMatch(/EACCES|secret|\\/);
    expect(await bytes()).toBe(before);
  });

  it('an unchanged form does not touch the registry at all', async () => {
    const exploding: CvModelRepository = {
      ...models,
      find: async () => {
        throw new Error('must not be read');
      },
      list: async () => {
        throw new Error('must not be read');
      },
    };
    const result = await editApplication(
      form({ ...LEGACY_UNTOUCHED, cvModelId: '', letterModelId: '' }),
      { ...deps, cvModelRepository: exploding },
    );
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
  });

  it('is logged in the history and an undo restores the previous value', async () => {
    const history = createJsonApplicationHistoryRepository({ filePath: join(directory, 'history.json') });
    const withHistory: WriteDeps = { ...deps, historyRepository: history };
    await editApplication(form({ jobId: LEGACY_ID, cvModelId: cvId, letterModelId: letterId }), withHistory);
    const [entry] = await history.listFor(LEGACY_ID);
    expect(entry?.changes.map((c) => c.field)).toEqual(['cvModelId', 'letterModelId']);
    expect(entry?.changes[0]).toMatchObject({ before: null, after: cvId });

    const undone = await revertChange(form({ entryId: entry?.id as string }), withHistory);
    expect(undone.ok).toBe(true);
    const app = await stored(LEGACY_ID);
    expect(app?.cvModelId).toBeUndefined();
    expect(app?.cvVariant).toBe('general');
  });
});

describe('editApplication - the model registry must be wired explicitly', () => {
  it('refuses a changed model id when no registry was injected, instead of reaching a global singleton', async () => {
    const { cvModelRepository: _omitted, ...withoutRegistry } = deps;
    const before = await bytes();

    const result = await editApplication(form({ jobId: IMPORTED_ID, cvModelId: cvId }), withoutRegistry);

    expect(result).toEqual({ ok: false, message: ACTION_MESSAGES.modelRegistryUnavailable });
    expect(await bytes()).toBe(before);
  });

  it('still accepts edits that do not touch a model field when no registry was injected', async () => {
    const { cvModelRepository: _omitted, ...withoutRegistry } = deps;

    const result = await editApplication(form({ jobId: IMPORTED_ID, notes: 'sin modelos' }), withoutRegistry);

    expect(result.ok).toBe(true);
    expect((await stored(IMPORTED_ID))?.notes).toBe('sin modelos');
  });
});
