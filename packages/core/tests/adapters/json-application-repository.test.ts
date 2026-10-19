import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonApplicationRepository } from '../../src/adapters/persistence/json-application-repository.js';
import type { ApplicationRepository } from '../../src/ports/application-repository.js';
import { REFERENCE_NOW, daysAgo } from '../helpers/make-job.js';

let directory: string;
let filePath: string;
let repository: ApplicationRepository;

const DRAFT = {
  jobId: 'acme::junior dev::madrid',
  appliedAt: REFERENCE_NOW,
  cvVariant: 'frontend' as const,
  scoreAtApply: 87.6,
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'app-log-'));
  filePath = join(directory, 'nested', 'applications.json');
  repository = createJsonApplicationRepository({ filePath });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('createJsonApplicationRepository - reading', () => {
  it('reads an empty log when the file has never been written', async () => {
    expect(await repository.list()).toEqual([]);
  });

  it('returns null for an unknown job', async () => {
    expect(await repository.findByJobId('nope')).toBeNull();
  });

  it('refuses to silently discard a corrupted log', async () => {
    await writeFile(filePath.replace(join('nested', 'applications.json'), 'flat.json'), '{');
    const broken = createJsonApplicationRepository({
      filePath: join(directory, 'flat.json'),
    });
    await expect(broken.list()).rejects.toThrow(/applications.*log|not valid|parse/i);
  });

  it('rejects a log whose entries do not match the schema', async () => {
    await writeFile(join(directory, 'bad.json'), JSON.stringify({ version: 1, applications: [{ jobId: 5 }] }));
    const broken = createJsonApplicationRepository({ filePath: join(directory, 'bad.json') });
    await expect(broken.list()).rejects.toThrow();
  });
});

describe('createJsonApplicationRepository - source ids', () => {
  it('round-trips the source ids through the file', async () => {
    await repository.record({ ...DRAFT, sourceIds: ['aggregator', 'manfred'] });
    const reread = createJsonApplicationRepository({ filePath });

    expect((await reread.list())[0]?.sourceIds).toEqual(['aggregator', 'manfred']);
  });

  it('loads a legacy log without source ids as an empty list', async () => {
    const legacy = join(directory, 'legacy.json');
    await writeFile(
      legacy,
      JSON.stringify({
        version: 1,
        applications: [
          {
            jobId: 'old::job::x',
            appliedAt: REFERENCE_NOW.toISOString(),
            cvVariant: 'general',
            scoreAtApply: 50,
            outcome: 'applied',
            outcomeUpdatedAt: REFERENCE_NOW.toISOString(),
          },
        ],
      }),
    );

    const loaded = await createJsonApplicationRepository({ filePath: legacy }).list();
    expect(loaded[0]?.sourceIds).toEqual([]);
  });
});

describe('createJsonApplicationRepository - recording', () => {
  it('creates the directory and file on first write', async () => {
    const result = await repository.record(DRAFT);
    expect(result.created).toBe(true);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('round-trips an application through the file, dates included', async () => {
    await repository.record(DRAFT);
    const reloaded = createJsonApplicationRepository({ filePath });
    const stored = await reloaded.findByJobId(DRAFT.jobId);

    expect(stored?.jobId).toBe(DRAFT.jobId);
    expect(stored?.cvVariant).toBe('frontend');
    expect(stored?.scoreAtApply).toBe(87.6);
    expect(stored?.appliedAt).toBeInstanceOf(Date);
    expect(stored?.appliedAt.getTime()).toBe(REFERENCE_NOW.getTime());
    expect(stored?.outcome).toBe('applied');
  });

  it('is idempotent: recording the same job twice creates one application', async () => {
    const first = await repository.record(DRAFT);
    const second = await repository.record({ ...DRAFT, appliedAt: daysAgo(-1), scoreAtApply: 12 });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await repository.list()).toHaveLength(1);
  });

  it('never overwrites the original record on a repeated apply', async () => {
    await repository.record(DRAFT);
    const second = await repository.record({ ...DRAFT, scoreAtApply: 12, cvVariant: 'general' });

    expect(second.application.scoreAtApply).toBe(87.6);
    expect(second.application.cvVariant).toBe('frontend');
  });

  it('survives concurrent recordings of different jobs without losing any', async () => {
    const drafts = Array.from({ length: 25 }, (_, index) => ({
      ...DRAFT,
      jobId: `job-${index}`,
    }));

    await Promise.all(drafts.map((draft) => repository.record(draft)));

    expect(await repository.list()).toHaveLength(25);
  });

  it('stays idempotent under concurrent recordings of the SAME job', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.record(DRAFT)),
    );

    expect(await repository.list()).toHaveLength(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it('lists newest first', async () => {
    await repository.record({ ...DRAFT, jobId: 'old', appliedAt: daysAgo(5) });
    await repository.record({ ...DRAFT, jobId: 'new', appliedAt: daysAgo(1) });

    expect((await repository.list()).map((entry) => entry.jobId)).toEqual(['new', 'old']);
  });

  it('leaves no temporary files behind', async () => {
    await repository.record(DRAFT);
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(join(directory, 'nested'));
    expect(entries).toEqual(['applications.json']);
  });
});

describe('createJsonApplicationRepository - outcomes', () => {
  it('updates the outcome of an existing application', async () => {
    await repository.record(DRAFT);
    const updated = await repository.updateOutcome({
      jobId: DRAFT.jobId,
      outcome: 'interview',
      at: daysAgo(-2),
    });

    expect(updated?.outcome).toBe('interview');
    expect((await repository.findByJobId(DRAFT.jobId))?.outcome).toBe('interview');
  });

  it('keeps appliedAt frozen when the outcome changes', async () => {
    await repository.record(DRAFT);
    await repository.updateOutcome({ jobId: DRAFT.jobId, outcome: 'rejected', at: daysAgo(-4) });
    const stored = await repository.findByJobId(DRAFT.jobId);

    expect(stored?.appliedAt.getTime()).toBe(REFERENCE_NOW.getTime());
    expect(stored?.outcomeUpdatedAt.getTime()).toBe(daysAgo(-4).getTime());
  });

  it('stores notes alongside the outcome', async () => {
    await repository.record(DRAFT);
    await repository.updateOutcome({
      jobId: DRAFT.jobId,
      outcome: 'screening',
      at: REFERENCE_NOW,
      notes: 'phone call on Friday',
    });

    expect((await repository.findByJobId(DRAFT.jobId))?.notes).toBe('phone call on Friday');
  });

  it('returns null when asked to update a job that was never applied to', async () => {
    expect(
      await repository.updateOutcome({ jobId: 'ghost', outcome: 'offer', at: REFERENCE_NOW }),
    ).toBeNull();
  });
});

describe('createJsonApplicationRepository - imported history', () => {
  it('round-trips an application that has a listing and no CV or score', async () => {
    await repository.record({
      jobId: 'import-1',
      appliedAt: REFERENCE_NOW,
      outcome: 'rejected',
      sourceIds: ['infojobs'],
      listing: { company: 'Acme', title: 'Junior Dev', url: 'https://example.com/o/1', portal: 'InfoJobs' },
    });
    const reread = createJsonApplicationRepository({ filePath });
    const [entry] = await reread.list();

    expect(entry?.cvVariant).toBeUndefined();
    expect(entry?.scoreAtApply).toBeUndefined();
    expect(entry?.listing).toEqual({ company: 'Acme', title: 'Junior Dev', url: 'https://example.com/o/1', portal: 'InfoJobs' });
    expect(entry?.outcome).toBe('rejected');
  });

  it('still loads a legacy log whose entries have no listing', async () => {
    await repository.record(DRAFT);
    const [entry] = await createJsonApplicationRepository({ filePath }).list();

    expect(entry?.cvVariant).toBe('frontend');
    expect(entry?.listing).toBeUndefined();
  });
});
