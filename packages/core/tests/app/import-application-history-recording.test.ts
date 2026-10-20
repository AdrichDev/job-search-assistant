import { describe, expect, it } from 'vitest';
import { importApplicationHistory } from '../../src/app/import-application-history.js';
import { createApplication } from '../../src/domain/application.js';
import type { HistoryRow } from '../../src/ports/history-reader.js';
import { createInMemoryApplicationHistoryRepository } from '../helpers/in-memory-application-history-repository.js';
import { createInMemoryApplicationRepository } from '../helpers/in-memory-application-repository.js';

const NOW = new Date('2026-05-01T08:00:00.000Z');

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    rowNumber: 2,
    company: 'Acme Ñandú',
    title: 'Junior Dev',
    appliedAt: new Date('2026-01-10T00:00:00Z'),
    companyInfo: '',
    city: 'Madrid',
    address: '',
    phone: '',
    contact: '',
    url: 'https://example.test/job/1',
    listNumber: '1',
    replied: 'No',
    status: 'En proceso',
    portal: 'InfoJobs',
    ...overrides,
  };
}

const QUEUE_MADE = createApplication({
  jobId: 'acme ñandú::junior dev::madrid',
  appliedAt: new Date('2026-01-10T15:30:00Z'),
  cvVariant: 'frontend',
  scoreAtApply: 80,
  sourceIds: ['manfred'],
  notes: 'Nota previa',
});

function setup(seed = [QUEUE_MADE]) {
  const repository = createInMemoryApplicationRepository(seed);
  const history = createInMemoryApplicationHistoryRepository();
  let counter = 0;
  return { repository, history, deps: { repository, history, now: () => NOW, newId: () => `imp-${++counter}` } };
}

describe('importApplicationHistory recording', () => {
  it('records an import entry for each existing application whose state it updated', async () => {
    const { deps, history } = setup();
    const result = await importApplicationHistory(
      [row({ status: 'Rechazado', replied: 'Sí', respondedAt: new Date('2026-01-14T00:00:00Z') })],
      deps,
    );
    expect(result.updatedExisting).toBe(1);
    expect(history.all()).toEqual([
      {
        id: 'imp-1',
        jobId: QUEUE_MADE.jobId,
        at: NOW,
        source: 'import',
        changes: [
          { field: 'outcome', before: 'applied', after: 'rejected' },
          { field: 'outcomeUpdatedAt', before: '2026-01-10T15:30:00.000Z', after: '2026-01-14T00:00:00.000Z' },
        ],
      },
    ]);
  });

  it('does not log creations, matches without update, or re-imports', async () => {
    const { deps, history } = setup();
    await importApplicationHistory([row({ rowNumber: 5, company: 'Otra', listNumber: '9' })], deps);
    await importApplicationHistory([row()], deps); // matches, same state: no update
    await importApplicationHistory([row({ rowNumber: 5, company: 'Otra', listNumber: '9' })], deps); // already imported
    expect(history.all()).toEqual([]);
  });

  it('still imports when the history cannot be written, and reports it', async () => {
    const repository = createInMemoryApplicationRepository([QUEUE_MADE]);
    const history = createInMemoryApplicationHistoryRepository({ failAppend: true });
    const result = await importApplicationHistory(
      [row({ status: 'Rechazado', replied: 'Sí' })],
      { repository, history, now: () => NOW },
    );
    expect(result.updatedExisting).toBe(1);
    expect(result.historyFailures).toBe(1);
    expect((await repository.findByJobId(QUEUE_MADE.jobId))?.outcome).toBe('rejected');
  });

  it('works without a history dependency', async () => {
    const repository = createInMemoryApplicationRepository([QUEUE_MADE]);
    const result = await importApplicationHistory([row({ status: 'Rechazado', replied: 'Sí' })], { repository });
    expect(result.updatedExisting).toBe(1);
    expect(result.historyFailures).toBeUndefined();
  });
});
