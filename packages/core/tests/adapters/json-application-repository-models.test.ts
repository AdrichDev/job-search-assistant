import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonApplicationRepository } from '../../src/adapters/persistence/json-application-repository.js';
import type { ApplicationRepository } from '../../src/ports/application-repository.js';

const NOW = new Date('2026-04-10T09:30:00.000Z');
const LEGACY_ID = 'beta soluciones::qa júnior::barcelona';

const SEED = {
  version: 1,
  applications: [
    {
      jobId: LEGACY_ID,
      appliedAt: '2026-02-10T00:00:00.000Z',
      cvVariant: 'general',
      scoreAtApply: 61,
      sourceIds: [],
      outcome: 'screening',
      outcomeUpdatedAt: '2026-02-15T00:00:00.000Z',
    },
    {
      jobId: 'import-aaaa1111',
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      outcomeUpdatedAt: '2026-03-01T00:00:00.000Z',
      listing: { company: 'Información Ñandú S.L.', title: 'Desarrollador Júnior' },
    },
  ],
};

let directory: string;
let filePath: string;
let repository: ApplicationRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'app-log-models-'));
  filePath = join(directory, 'applications.json');
  await writeFile(filePath, `${JSON.stringify(SEED, null, 2)}\n`, 'utf8');
  repository = createJsonApplicationRepository({ filePath });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('model references in the JSON application log', () => {
  it('loads an existing log with no model keys unchanged', async () => {
    const all = await repository.list();
    expect(all).toHaveLength(2);
    expect(all.every((a) => !('cvModelId' in a) && !('letterModelId' in a))).toBe(true);
  });

  it('round-trips both ids and keeps the legacy variant', async () => {
    const result = await repository.update({
      jobId: LEGACY_ID,
      patch: { cvModelId: 'cv-1', letterModelId: 'let-1' },
      now: NOW,
    });
    expect(result?.after.cvModelId).toBe('cv-1');
    const stored = JSON.parse(await readFile(filePath, 'utf8')) as { applications: Record<string, unknown>[] };
    const row = stored.applications.find((a) => a.jobId === LEGACY_ID)!;
    expect(row).toMatchObject({ cvModelId: 'cv-1', letterModelId: 'let-1', cvVariant: 'general' });

    const fresh = createJsonApplicationRepository({ filePath });
    const loaded = await fresh.findByJobId(LEGACY_ID);
    expect(loaded?.cvModelId).toBe('cv-1');
    expect(loaded?.letterModelId).toBe('let-1');
  });

  it('clearing removes the keys from the file', async () => {
    await repository.update({ jobId: LEGACY_ID, patch: { cvModelId: 'cv-1' }, now: NOW });
    await repository.update({ jobId: LEGACY_ID, patch: { cvModelId: null }, now: NOW });
    expect(await readFile(filePath, 'utf8')).not.toContain('cvModelId');
  });

  it('a no-op update leaves the file byte-identical and never adds the keys', async () => {
    const before = await readFile(filePath, 'utf8');
    await repository.update({ jobId: LEGACY_ID, patch: { notes: '' }, now: NOW });
    await repository.update({ jobId: LEGACY_ID, patch: { cvModelId: null }, now: NOW });
    expect(await readFile(filePath, 'utf8')).toBe(before);
  });

  it('updating another record adds no keys to an untouched legacy record', async () => {
    await repository.update({ jobId: 'import-aaaa1111', patch: { cvModelId: 'cv-1' }, now: NOW });
    const stored = JSON.parse(await readFile(filePath, 'utf8')) as { applications: Record<string, unknown>[] };
    const legacy = stored.applications.find((a) => a.jobId === LEGACY_ID)!;
    expect(legacy).toEqual(SEED.applications[0]);
  });

  it('refuses a too long id with a patch error and writes nothing', async () => {
    const before = await readFile(filePath, 'utf8');
    await expect(
      repository.update({ jobId: LEGACY_ID, patch: { cvModelId: 'x'.repeat(81) }, now: NOW }),
    ).rejects.toMatchObject({ reason: 'too_long' });
    expect(await readFile(filePath, 'utf8')).toBe(before);
  });
});
