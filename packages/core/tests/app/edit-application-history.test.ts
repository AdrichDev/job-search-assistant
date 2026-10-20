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

function setup(options: { failAppend?: boolean } = {}) {
  const repository = createInMemoryApplicationRepository([IMPORTED, LEGACY]);
  const history = createInMemoryApplicationHistoryRepository(options);
  return { repository, history, deps: { repository, history, now: () => NOW, newId: () => 'entry-1' } };
}

describe('editApplication with a change history', () => {
  it('appends exactly one manual entry with the diff of a successful edit', async () => {
    const { deps, history } = setup();
    const result = await editApplication(
      { jobId: IMPORTED.jobId, patch: { outcome: 'rejected', notes: 'Rechazo ñ' } },
      deps,
    );
    expect(result).toMatchObject({ status: 'updated', historyRecorded: true });
    expect(history.all()).toEqual([
      {
        id: 'entry-1',
        jobId: IMPORTED.jobId,
        at: NOW,
        source: 'manual',
        changes: [
          { field: 'outcome', before: 'applied', after: 'rejected' },
          { field: 'outcomeUpdatedAt', before: '2026-03-01T00:00:00.000Z', after: NOW.toISOString() },
          { field: 'notes', before: null, after: 'Rechazo ñ' },
        ],
      },
    ]);
  });

  it('logs a legacy row listing creation as null -> value', async () => {
    const { deps, history } = setup();
    await editApplication(
      { jobId: LEGACY.jobId, patch: { listing: { company: 'Beta Soluciones', title: 'QA Júnior' } } },
      deps,
    );
    expect(history.all()[0]?.changes).toEqual([
      { field: 'listing.company', before: null, after: 'Beta Soluciones' },
      { field: 'listing.title', before: null, after: 'QA Júnior' },
    ]);
  });

  it('writes no entry for a no-op edit', async () => {
    const { deps, history } = setup();
    const result = await editApplication({ jobId: IMPORTED.jobId, patch: { listing: { city: 'Alcobendas' } } }, deps);
    expect(result.status).toBe('unchanged');
    expect(history.all()).toEqual([]);
  });

  it('writes no entry for a refused edit or an unknown job', async () => {
    const { deps, history } = setup();
    expect((await editApplication({ jobId: IMPORTED.jobId, patch: { listing: { url: 'ftp://x' } } }, deps)).status).toBe('invalid');
    expect((await editApplication({ jobId: 'nope', patch: { notes: 'x' } }, deps)).status).toBe('not_found');
    expect(history.all()).toEqual([]);
  });

  it('does not hide a failed append: the edit is kept and historyRecorded is false', async () => {
    const { deps, repository } = setup({ failAppend: true });
    const result = await editApplication({ jobId: IMPORTED.jobId, patch: { notes: 'guardada' } }, deps);
    expect(result).toMatchObject({ status: 'updated', historyRecorded: false });
    expect((await repository.findByJobId(IMPORTED.jobId))?.notes).toBe('guardada');
  });

  it('still works without a history dependency', async () => {
    const repository = createInMemoryApplicationRepository([IMPORTED]);
    const result = await editApplication({ jobId: IMPORTED.jobId, patch: { notes: 'x' } }, { repository, now: () => NOW });
    expect(result).toMatchObject({ status: 'updated', historyRecorded: false });
  });
});
