import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTrackedApplications,
  createApplication,
  createJsonApplicationRepository,
  type ApplicationRepository,
} from '@job-queue/core';
import { ACTION_MESSAGES } from '@/copy/action-messages';
import { ES } from '@/copy/es';
import { buildEditFormValues } from '@/server/edit-form';
import { editApplication, type WriteDeps } from '@/server/use-cases';

/**
 * The manual edit path (CU7), through the REAL JSON repository on a temp file,
 * with fixtures shaped like the real log: imported rows have a listing and no
 * cvVariant/score; legacy queue-made rows have no listing and a 3-part id.
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
let deps: WriteDeps;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'edit-app-'));
  filePath = join(directory, 'applications.json');
  await writeFile(filePath, `${JSON.stringify(SEED, null, 2)}\n`, 'utf8');
  repository = createJsonApplicationRepository({ filePath });
  deps = { applicationRepository: repository, loadQueue: async () => null, now: () => NOW };
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

const bytes = () => readFile(filePath, 'utf8');

describe('editApplication - input validation (everything arrives as unknown)', () => {
  it.each([null, undefined, 'jobId=x', 42, {}, [], Symbol('x')])(
    'refuses a non-FormData input %s',
    async (input) => {
      const before = await bytes();
      const result = await editApplication(input, deps);
      expect(result).toEqual({ ok: false, message: ACTION_MESSAGES.invalidInput });
      expect(await bytes()).toBe(before);
    },
  );

  it('refuses a missing job id', async () => {
    expect(await editApplication(form({ notes: 'x' }), deps)).toEqual({
      ok: false,
      message: ACTION_MESSAGES.missingJobId,
    });
  });

  it('refuses a field that is a file instead of text', async () => {
    const data = form({ jobId: IMPORTED_ID });
    data.append('notes', new File(['x'], 'notes.txt'));
    expect(await editApplication(data, deps)).toEqual({ ok: false, message: ACTION_MESSAGES.invalidInput });
  });

  it('refuses a job id that is a file', async () => {
    const data = new FormData();
    data.append('jobId', new File(['x'], 'id.txt'));
    expect((await editApplication(data, deps)).ok).toBe(false);
  });

  it.each(['2026-02-30', 'abc', '2026-1-1', '', '2026-13-01', '01/03/2026', '2026-03-01T00:00:00Z'])(
    'refuses appliedAt %j',
    async (value) => {
      const before = await bytes();
      expect(await editApplication(form({ jobId: IMPORTED_ID, appliedAt: value }), deps)).toEqual({
        ok: false,
        message: ACTION_MESSAGES.invalidDate,
      });
      expect(await bytes()).toBe(before);
    },
  );

  it('refuses a bad outcome date and a bad published date', async () => {
    for (const field of ['outcomeUpdatedAt', 'publishedAt']) {
      const result = await editApplication(form({ jobId: IMPORTED_ID, [field]: '31/12/2026' }), deps);
      expect(result.message).toBe(ACTION_MESSAGES.invalidDate);
    }
  });

  it('refuses an unknown outcome', async () => {
    expect(await editApplication(form({ jobId: IMPORTED_ID, outcome: 'ghosted' }), deps)).toEqual({
      ok: false,
      message: ACTION_MESSAGES.invalidOutcome,
    });
  });

  it('refuses an unknown cv variant', async () => {
    expect(await editApplication(form({ jobId: IMPORTED_ID, cvVariant: 'wizard' }), deps)).toEqual({
      ok: false,
      message: ACTION_MESSAGES.invalidCvVariant,
    });
  });

  it('refuses huge strings without touching the file', async () => {
    const before = await bytes();
    for (const field of ['notes', 'company', 'city', 'url', 'sourceIds']) {
      const result = await editApplication(
        form({ jobId: IMPORTED_ID, [field]: `https://x.test/${'a'.repeat(1_000_000)}` }),
        deps,
      );
      expect(result.ok, field).toBe(false);
    }
    expect(await bytes()).toBe(before);
  });
});

describe('editApplication - outcomes', () => {
  it('edits state and notes of an imported application', async () => {
    const result = await editApplication(
      form({
        jobId: IMPORTED_ID,
        outcome: 'rejected',
        // The form pre-fills the old reply date: it must not be kept silently.
        outcomeUpdatedAt: '2026-03-01',
        notes: 'Rechazo por correo: «no encaja»',
      }),
      deps,
    );
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEdited });

    const stored = await repository.findByJobId(IMPORTED_ID);
    expect(stored?.outcome).toBe('rejected');
    expect(stored?.outcomeUpdatedAt.toISOString()).toBe(NOW.toISOString());
    expect(stored?.notes).toBe('Rechazo por correo: «no encaja»');
    expect(stored?.listing?.company).toBe('Información Ñandú S.L.');
  });

  it('uses an explicit new reply date as that day at 00:00 UTC', async () => {
    await editApplication(
      form({ jobId: IMPORTED_ID, outcome: 'rejected', outcomeUpdatedAt: '2026-03-20' }),
      deps,
    );
    expect((await repository.findByJobId(IMPORTED_ID))?.outcomeUpdatedAt.toISOString()).toBe(
      '2026-03-20T00:00:00.000Z',
    );
  });

  it('keeps the time of a date whose day was not touched', async () => {
    const result = await editApplication(
      form({ jobId: LEGACY_ID, appliedAt: '2026-02-10', outcomeUpdatedAt: '2026-02-15', notes: 'x' }),
      deps,
    );
    expect(result.ok).toBe(true);
    const stored = await repository.findByJobId(LEGACY_ID);
    expect(stored?.appliedAt.toISOString()).toBe('2026-02-10T12:34:56.000Z');
    expect(stored?.outcomeUpdatedAt.toISOString()).toBe('2026-02-15T12:34:56.000Z');
  });

  it('moves appliedAt when the day really changes', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, appliedAt: '2026-03-04' }), deps);
    expect((await repository.findByJobId(IMPORTED_ID))?.appliedAt.toISOString()).toBe(
      '2026-03-04T00:00:00.000Z',
    );
  });

  it('reports unchanged and leaves the file byte-identical when nothing differs', async () => {
    const before = await bytes();
    const result = await editApplication(
      form({
        jobId: IMPORTED_ID,
        appliedAt: '2026-03-01',
        outcome: 'applied',
        outcomeUpdatedAt: '2026-03-01',
        cvVariant: '',
        sourceIds: 'infojobs',
        company: 'Información Ñandú S.L.',
        title: 'Desarrollador Júnior Frontend',
        url: 'https://empleo.example.test/oferta/1',
        portal: 'InfoJobs',
        city: 'Alcobendas',
        address: '',
        phone: '',
        contact: '',
        companyInfo: '',
        publishedAt: '',
        notes: 'Ñ'.repeat(3000),
      }),
      deps,
    );
    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
    expect(await bytes()).toBe(before);
  });

  it('reports not found for an unknown job', async () => {
    expect(await editApplication(form({ jobId: 'nope', notes: 'x' }), deps)).toEqual({
      ok: false,
      message: ACTION_MESSAGES.applicationNotFound,
    });
  });
});

describe('editApplication - clearing and patch semantics', () => {
  it('treats an absent key as unchanged', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, notes: 'solo notas' }), deps);
    const stored = await repository.findByJobId(IMPORTED_ID);
    expect(stored?.notes).toBe('solo notas');
    expect(stored?.listing?.city).toBe('Alcobendas');
    expect(stored?.outcome).toBe('applied');
  });

  it('clears optional text with an empty string and the cv with an empty option', async () => {
    await editApplication(
      form({ jobId: LEGACY_ID, cvVariant: '', notes: '' }),
      deps,
    );
    const legacy = await repository.findByJobId(LEGACY_ID);
    expect(legacy?.cvVariant).toBeUndefined();
    expect(legacy?.scoreAtApply).toBe(61);

    await editApplication(form({ jobId: IMPORTED_ID, city: '', url: '  ', publishedAt: '' }), deps);
    const imported = await repository.findByJobId(IMPORTED_ID);
    expect(imported?.listing?.city).toBeUndefined();
    expect(imported?.listing?.url).toBeUndefined();
    expect(imported?.listing?.company).toBe('Información Ñandú S.L.');
  });

  it('sets a published date and then clears it', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, publishedAt: '2026-02-27' }), deps);
    expect((await repository.findByJobId(IMPORTED_ID))?.listing?.publishedAt?.toISOString()).toBe(
      '2026-02-27T00:00:00.000Z',
    );
    await editApplication(form({ jobId: IMPORTED_ID, publishedAt: '' }), deps);
    expect((await repository.findByJobId(IMPORTED_ID))?.listing?.publishedAt).toBeUndefined();
  });

  it('parses source ids: trimmed and de-duplicated', async () => {
    await editApplication(form({ jobId: IMPORTED_ID, sourceIds: ' linkedin, infojobs ,linkedin,, ' }), deps);
    expect((await repository.findByJobId(IMPORTED_ID))?.sourceIds).toEqual(['linkedin', 'infojobs']);
  });

  it('refuses a bad url, keeps the stored file byte-identical', async () => {
    const before = await bytes();
    expect(await editApplication(form({ jobId: IMPORTED_ID, url: 'javascript:alert(1)' }), deps)).toEqual({
      ok: false,
      message: ACTION_MESSAGES.invalidUrl,
    });
    expect(await bytes()).toBe(before);
  });

  it('refuses a blank company and a blank title', async () => {
    expect((await editApplication(form({ jobId: IMPORTED_ID, company: ' ' }), deps)).message).toBe(
      ACTION_MESSAGES.blankCompany,
    );
    expect((await editApplication(form({ jobId: IMPORTED_ID, title: '' }), deps)).message).toBe(
      ACTION_MESSAGES.blankTitle,
    );
  });

  it('refuses listing fields without company and title on a queue-made row', async () => {
    const before = await bytes();
    expect((await editApplication(form({ jobId: LEGACY_ID, city: 'Madrid' }), deps)).message).toBe(
      ACTION_MESSAGES.listingIncomplete,
    );
    expect(await bytes()).toBe(before);
  });

  it('creates a listing on a queue-made row when company and title come along', async () => {
    const result = await editApplication(
      form({ jobId: LEGACY_ID, company: 'Beta Soluciones', title: 'QA Júnior', city: 'Barcelona' }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect((await repository.findByJobId(LEGACY_ID))?.listing).toEqual({
      company: 'Beta Soluciones',
      title: 'QA Júnior',
      city: 'Barcelona',
    });
  });
});

describe('buildEditFormValues', () => {
  it('pre-fills an imported application from its listing', () => {
    const application = createApplication({
      jobId: IMPORTED_ID,
      appliedAt: new Date('2026-03-01T00:00:00.000Z'),
      sourceIds: ['infojobs', 'linkedin'],
      notes: 'nota',
      listing: { company: 'Ñandú', title: 'Júnior', city: 'Alcobendas', publishedAt: new Date('2026-02-27T00:00:00Z') },
    });
    const values = buildEditFormValues(application, undefined);
    expect(values).toMatchObject({
      jobId: IMPORTED_ID,
      appliedAt: '2026-03-01',
      outcome: 'applied',
      outcomeUpdatedAt: '2026-03-01',
      cvVariant: '',
      notes: 'nota',
      sourceIds: 'infojobs, linkedin',
      company: 'Ñandú',
      title: 'Júnior',
      city: 'Alcobendas',
      url: '',
      publishedAt: '2026-02-27',
    });
  });

  it('pre-fills company and title of a queue-made application from the tracked row', () => {
    const application = createApplication({
      jobId: LEGACY_ID,
      appliedAt: new Date('2026-02-10T12:00:00.000Z'),
      cvVariant: 'general',
    });
    const values = buildEditFormValues(application, {
      jobId: LEGACY_ID,
      company: 'beta soluciones',
      title: 'qa júnior',
      city: 'barcelona',
      sourceIds: [],
      appliedAt: application.appliedAt,
      outcome: 'applied',
      outcomeUpdatedAt: application.outcomeUpdatedAt,
      origin: 'queue',
    });
    expect(values).toMatchObject({ company: 'beta soluciones', title: 'qa júnior', city: 'barcelona', cvVariant: 'general' });
  });
});

describe('editApplication - an untouched pre-filled form changes nothing', () => {
  /** The form exactly as the page pre-fills it, optionally with fields the person changed. */
  async function prefilled(jobId: string, changes: Record<string, string> = {}): Promise<FormData> {
    const application = await repository.findByJobId(jobId);
    if (application === null) {
      throw new Error('fixture missing');
    }
    const row = buildTrackedApplications([application], [])[0];
    const values = buildEditFormValues(application, row);
    return form({ ...values, ...changes });
  }

  it('says unchanged and leaves the file byte-identical for a legacy queue-made row', async () => {
    const before = await bytes();

    const result = await editApplication(await prefilled(LEGACY_ID), deps);

    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
    expect(await bytes()).toBe(before);
  });

  it('says unchanged and leaves the file byte-identical for an imported row', async () => {
    const before = await bytes();

    const result = await editApplication(await prefilled(IMPORTED_ID), deps);

    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
    expect(await bytes()).toBe(before);
  });

  it('does not create a listing on a legacy row when only the notes change', async () => {
    const result = await editApplication(await prefilled(LEGACY_ID, { notes: 'Llamar el lunes' }), deps);

    expect(result.ok).toBe(true);
    const stored = await repository.findByJobId(LEGACY_ID);
    expect(stored?.notes).toBe('Llamar el lunes');
    expect(stored?.listing).toBeUndefined();
    expect(stored?.sourceIds).toEqual([]);
  });

  it('creates the listing from the pre-filled company and title when a listing field changes', async () => {
    const result = await editApplication(await prefilled(LEGACY_ID, { city: 'Valencia' }), deps);

    expect(result.ok).toBe(true);
    const stored = await repository.findByJobId(LEGACY_ID);
    expect(stored?.listing?.city).toBe('Valencia');
    expect(stored?.listing?.company).toBe('beta soluciones');
    expect(stored?.listing?.title).toBe('qa júnior');
  });

  it('still applies a real change to the state', async () => {
    const result = await editApplication(await prefilled(LEGACY_ID, { outcome: 'rejected' }), deps);

    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEdited });
    expect((await repository.findByJobId(LEGACY_ID))?.outcome).toBe('rejected');
  });
});

describe('T2d - Información breve empresa (CU9)', () => {
  const LABEL = 'Información breve empresa';

  it('uses the spreadsheet label for the edit field and for the history entry', () => {
    expect(ES.edit.fields.companyInfo).toBe(LABEL);
    expect(ES.history.fields['listing.companyInfo']).toBe(LABEL);
  });

  it('CRLF company info (what a browser posts) equal to the stored LF text is no change at all', async () => {
    const stored = 'L\u00ednea uno.\n\nL\u00ednea tres.\n  Sangr\u00eda';
    const seed = {
      version: 1,
      applications: [
        {
          jobId: 'import-eeee5555',
          appliedAt: '2026-03-01T00:00:00.000Z',
          sourceIds: ['infojobs'],
          outcome: 'applied',
          outcomeUpdatedAt: '2026-03-01T00:00:00.000Z',
          listing: { company: '\u00d1and\u00fa S.L.', title: 'J\u00fanior', companyInfo: stored },
        },
      ],
    };
    await writeFile(filePath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
    const before = await bytes();
    const application = await repository.findByJobId('import-eeee5555');
    if (application === null) {
      throw new Error('fixture missing');
    }
    // The use case always asks the repository; what matters is that the patch is empty.
    const patches: unknown[] = [];
    const spied: ApplicationRepository = {
      ...repository,
      update: async (input) => {
        patches.push(input.patch);
        return repository.update(input);
      },
    };
    const appended: unknown[] = [];
    const history = {
      append: async (entry: unknown) => void appended.push(entry),
      listFor: async () => [],
      find: async () => null,
    };

    const values = buildEditFormValues(application, buildTrackedApplications([application], [])[0]);
    const result = await editApplication(
      form({ ...values, companyInfo: stored.replace(/\n/g, '\r\n') }),
      { ...deps, applicationRepository: spied, historyRepository: history },
    );

    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
    expect(patches).toEqual([{}]);
    expect(appended).toEqual([]);
    expect(await bytes()).toBe(before);
  });

  it('a really changed CRLF company info is stored with LF newlines', async () => {
    const application = await repository.findByJobId(IMPORTED_ID);
    if (application === null) {
      throw new Error('fixture missing');
    }
    const values = buildEditFormValues(application, buildTrackedApplications([application], [])[0]);

    const result = await editApplication(form({ ...values, companyInfo: 'Uno\r\nDos\r\n\r\nTres' }), deps);

    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationEdited });
    expect((await repository.findByJobId(IMPORTED_ID))?.listing?.companyInfo).toBe('Uno\nDos\n\nTres');
  });

  it('does not normalise line breaks of other fields', async () => {
    const application = await repository.findByJobId(IMPORTED_ID);
    if (application === null) {
      throw new Error('fixture missing');
    }
    const values = buildEditFormValues(application, buildTrackedApplications([application], [])[0]);

    await editApplication(form({ ...values, notes: 'a\r\nb' }), deps);

    expect((await repository.findByJobId(IMPORTED_ID))?.notes).toBe('a\r\nb');
  });

  it('an untouched multiline company info is a no-op that leaves the file byte-identical', async () => {
    const multiline = 'Línea uno.\n\nLínea tres, con ñ.\n  Sangría final';
    const seed = {
      version: 1,
      applications: [
        {
          jobId: 'import-dddd4444',
          appliedAt: '2026-03-01T00:00:00.000Z',
          sourceIds: ['infojobs'],
          outcome: 'applied',
          outcomeUpdatedAt: '2026-03-01T00:00:00.000Z',
          listing: { company: 'Ñandú S.L.', title: 'Júnior', companyInfo: multiline },
        },
      ],
    };
    await writeFile(filePath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
    const before = await bytes();
    const application = await repository.findByJobId('import-dddd4444');
    if (application === null) {
      throw new Error('fixture missing');
    }

    const values = buildEditFormValues(application, buildTrackedApplications([application], [])[0]);
    expect(values.companyInfo).toBe(multiline);
    const result = await editApplication(form({ ...values }), deps);

    expect(result).toEqual({ ok: true, message: ACTION_MESSAGES.applicationUnchanged });
    expect(await bytes()).toBe(before);
  });
});
