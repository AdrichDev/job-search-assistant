import { describe, expect, it } from 'vitest';
import { editApplication } from '../../src/app/edit-application.js';
import { createApplication } from '../../src/domain/application.js';
import { createInMemoryApplicationHistoryRepository } from '../helpers/in-memory-application-history-repository.js';
import { createInMemoryApplicationRepository } from '../helpers/in-memory-application-repository.js';

const NOW = new Date('2026-04-10T09:30:00.000Z');

const IMPORTED = createApplication({
  jobId: 'import-aaaa1111',
  appliedAt: new Date('2026-03-01T00:00:00.000Z'),
  sourceIds: ['infojobs'],
  listing: { company: 'Información Ñandú S.L.', title: 'Desarrollador Júnior', city: 'Alcobendas' },
});
const LEGACY = createApplication({
  jobId: 'beta soluciones::qa júnior::barcelona',
  appliedAt: new Date('2026-02-10T00:00:00.000Z'),
  cvVariant: 'general',
  scoreAtApply: 61,
});

function setup() {
  const repository = createInMemoryApplicationRepository([IMPORTED, LEGACY]);
  return { repository, deps: { repository, now: () => NOW } };
}

describe('editApplication', () => {
  it('reports updated with before and after', async () => {
    const { deps } = setup();
    const result = await editApplication({ jobId: IMPORTED.jobId, patch: { outcome: 'rejected' } }, deps);
    expect(result.status).toBe('updated');
    if (result.status === 'updated') {
      expect(result.before.outcome).toBe('applied');
      expect(result.after.outcome).toBe('rejected');
    }
  });

  it('reports unchanged for a no-op patch', async () => {
    const { deps } = setup();
    const result = await editApplication(
      { jobId: IMPORTED.jobId, patch: { listing: { city: 'Alcobendas' } } },
      deps,
    );
    expect(result.status).toBe('unchanged');
  });

  it('reports not_found for an unknown job', async () => {
    const { deps } = setup();
    expect(await editApplication({ jobId: 'nope', patch: { notes: 'x' } }, deps)).toEqual({
      status: 'not_found',
    });
  });

  it.each([
    [{ listing: { url: 'javascript:alert(1)' } }, 'invalid_url'],
    [{ listing: { title: '' } }, 'blank_title'],
  ] as const)('maps a refused patch %j to invalid(%s)', async (patch, reason) => {
    const { deps, repository } = setup();
    const result = await editApplication({ jobId: IMPORTED.jobId, patch }, deps);
    expect(result).toEqual({ status: 'invalid', reason });
    expect((await repository.findByJobId(IMPORTED.jobId))?.listing?.title).toBe('Desarrollador Júnior');
  });

  it('refuses listing_incomplete on a queue-made application', async () => {
    const { deps } = setup();
    const result = await editApplication({ jobId: LEGACY.jobId, patch: { listing: { city: 'x' } } }, deps);
    expect(result).toEqual({ status: 'invalid', reason: 'listing_incomplete' });
  });

  it('lets unexpected repository failures through instead of hiding them', async () => {
    const { repository } = setup();
    const broken = { ...repository, update: async () => { throw new Error('disk on fire'); } };
    await expect(
      editApplication({ jobId: IMPORTED.jobId, patch: { notes: 'x' } }, { repository: broken, now: () => NOW }),
    ).rejects.toThrow('disk on fire');
  });
});

describe('editApplication history source', () => {
  it('records a custom source and reports the entry id', async () => {
    const repository = createInMemoryApplicationRepository([IMPORTED]);
    const history = createInMemoryApplicationHistoryRepository();
    const result = await editApplication(
      { jobId: IMPORTED.jobId, patch: { outcome: 'rejected' }, source: 'email' },
      { repository, history, now: () => NOW, newId: () => 'entry-7' },
    );
    expect(result).toMatchObject({ status: 'updated', historyRecorded: true, historyEntryId: 'entry-7' });
    expect(history.all()[0]).toMatchObject({ id: 'entry-7', source: 'email' });
  });

  it('defaults the source to manual', async () => {
    const repository = createInMemoryApplicationRepository([IMPORTED]);
    const history = createInMemoryApplicationHistoryRepository();
    await editApplication(
      { jobId: IMPORTED.jobId, patch: { notes: 'x' } },
      { repository, history, now: () => NOW, newId: () => 'entry-8' },
    );
    expect(history.all()[0]?.source).toBe('manual');
  });
});
