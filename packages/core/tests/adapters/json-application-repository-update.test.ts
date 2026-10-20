import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonApplicationRepository } from '../../src/adapters/persistence/json-application-repository.js';
import { ApplicationPatchError } from '../../src/domain/application.js';
import type { ApplicationRepository } from '../../src/ports/application-repository.js';

const NOW = new Date('2026-04-10T09:30:00.000Z');

/** Imported shape: listing, no cvVariant, no scoreAtApply. Legacy: no listing, empty sourceIds. */
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
      notes: 'Ñ'.repeat(5000),
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
      appliedAt: '2026-02-10T00:00:00.000Z',
      cvVariant: 'general',
      scoreAtApply: 61,
      sourceIds: [],
      outcome: 'screening',
      outcomeUpdatedAt: '2026-02-15T00:00:00.000Z',
    },
  ],
};

let directory: string;
let filePath: string;
let repository: ApplicationRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'app-log-update-'));
  filePath = join(directory, 'applications.json');
  await writeFile(filePath, `${JSON.stringify(SEED, null, 2)}\n`, 'utf8');
  repository = createJsonApplicationRepository({ filePath });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const bytes = () => readFile(filePath, 'utf8');

describe('ApplicationRepository.update', () => {
  it('persists the edit and returns before and after', async () => {
    const result = await repository.update({
      jobId: IMPORTED_ID,
      patch: { outcome: 'rejected', listing: { city: 'Móstoles' } },
      now: NOW,
    });

    expect(result?.before.outcome).toBe('applied');
    expect(result?.after.outcome).toBe('rejected');
    expect(result?.after.outcomeUpdatedAt.toISOString()).toBe(NOW.toISOString());

    const reread = await repository.findByJobId(IMPORTED_ID);
    expect(reread?.outcome).toBe('rejected');
    expect(reread?.listing?.city).toBe('Móstoles');
    expect(reread?.listing?.company).toBe('Información Ñandú S.L.');
    expect(reread?.notes).toBe('Ñ'.repeat(5000));
  });

  it('keeps the persisted format: absent keys stay absent, other records untouched', async () => {
    await repository.update({ jobId: IMPORTED_ID, patch: { notes: '' }, now: NOW });
    const raw = JSON.parse(await bytes()) as { applications: Record<string, unknown>[] };
    const imported = raw.applications.find((entry) => entry.jobId === IMPORTED_ID);
    expect(imported).toBeDefined();
    expect('notes' in (imported ?? {})).toBe(false);
    expect('cvVariant' in (imported ?? {})).toBe(false);
    expect('scoreAtApply' in (imported ?? {})).toBe(false);
    expect(raw.applications.find((entry) => entry.jobId === LEGACY_ID)).toEqual(SEED.applications[1]);
  });

  it('edits a legacy queue-made record, creating a listing when company and title come along', async () => {
    const result = await repository.update({
      jobId: LEGACY_ID,
      patch: { listing: { company: 'Beta Soluciones', title: 'QA Júnior' }, cvVariant: null },
      now: NOW,
    });
    expect(result?.after.listing?.company).toBe('Beta Soluciones');
    expect(result?.after.cvVariant).toBeUndefined();
    expect(result?.after.scoreAtApply).toBe(61);
    expect((await repository.findByJobId(LEGACY_ID))?.listing?.title).toBe('QA Júnior');
  });

  it('returns null for an unknown job and leaves the file byte-identical', async () => {
    const before = await bytes();
    expect(await repository.update({ jobId: 'nope', patch: { notes: 'x' }, now: NOW })).toBeNull();
    expect(await bytes()).toBe(before);
  });

  it.each([
    ['bad url', { listing: { url: 'javascript:alert(1)' } }],
    ['blank company', { listing: { company: '  ' } }],
    ['bad date', { appliedAt: new Date('nope') }],
  ])('refuses %s with a typed error and leaves the file byte-identical', async (_label, patch) => {
    const before = await bytes();
    await expect(repository.update({ jobId: IMPORTED_ID, patch, now: NOW })).rejects.toBeInstanceOf(
      ApplicationPatchError,
    );
    expect(await bytes()).toBe(before);
  });

  it('refuses listing_incomplete on a legacy record without writing', async () => {
    const before = await bytes();
    await expect(
      repository.update({ jobId: LEGACY_ID, patch: { listing: { city: 'Madrid' } }, now: NOW }),
    ).rejects.toMatchObject({ reason: 'listing_incomplete' });
    expect(await bytes()).toBe(before);
  });

  it('does not rewrite the file for a no-op patch', async () => {
    const before = await bytes();
    const result = await repository.update({
      jobId: IMPORTED_ID,
      patch: { outcome: 'applied', listing: { city: 'Alcobendas' } },
      now: NOW,
    });
    expect(result?.before).toEqual(result?.after);
    expect(await bytes()).toBe(before);
  });

  it('serialises concurrent updates so none is lost', async () => {
    await Promise.all([
      repository.update({ jobId: IMPORTED_ID, patch: { notes: 'primera' }, now: NOW }),
      repository.update({ jobId: IMPORTED_ID, patch: { listing: { portal: 'LinkedIn' } }, now: NOW }),
      repository.update({ jobId: LEGACY_ID, patch: { notes: 'segunda' }, now: NOW }),
    ]);
    const imported = await repository.findByJobId(IMPORTED_ID);
    expect(imported?.notes).toBe('primera');
    expect(imported?.listing?.portal).toBe('LinkedIn');
    expect((await repository.findByJobId(LEGACY_ID))?.notes).toBe('segunda');
  });

  it('refuses to overwrite an unreadable log', async () => {
    await writeFile(filePath, '{', 'utf8');
    await expect(repository.update({ jobId: IMPORTED_ID, patch: { notes: 'x' }, now: NOW })).rejects.toThrow();
    expect(await bytes()).toBe('{');
  });
});
