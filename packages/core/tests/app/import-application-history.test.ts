import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonApplicationRepository } from '../../src/adapters/persistence/json-application-repository.js';
import { importApplicationHistory } from '../../src/app/import-application-history.js';
import { createApplication } from '../../src/domain/application.js';
import { computeApplicationStats } from '../../src/domain/application-stats.js';
import type { HistoryRow } from '../../src/ports/history-reader.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'import-history-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    rowNumber: 2,
    company: 'Acme Fictional',
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

function repo() {
  return createJsonApplicationRepository({ filePath: join(dir, 'applications.json') });
}

describe('importApplicationHistory', () => {
  it('maps outcomes, source slug and listing', async () => {
    const repository = repo();
    const result = await importApplicationHistory(
      [
        row({ rowNumber: 2, listNumber: '1', status: 'Rechazado', replied: 'Sí' }),
        row({ rowNumber: 3, listNumber: '2', status: 'En proceso', replied: 'No' }),
        row({ rowNumber: 4, listNumber: '3', status: 'En proceso', replied: 'Sí', portal: 'Web de la empresa' }),
        row({ rowNumber: 5, listNumber: '4', portal: '' }),
      ],
      { repository },
    );
    expect(result).toEqual({ imported: 4, alreadyImported: 0, skipped: [] });
    const all = await repository.list();
    expect(all.map((a) => a.outcome).sort()).toEqual(['applied', 'applied', 'rejected', 'screening']);
    const screening = all.find((a) => a.outcome === 'screening');
    expect(screening?.sourceIds).toEqual(['web-de-la-empresa']);
    expect(all.find((a) => a.outcome === 'rejected')?.sourceIds).toEqual(['infojobs']);
    expect(all.filter((a) => a.sourceIds.length === 0)).toHaveLength(1);
    expect(all[0]?.listing?.company).toBe('Acme Fictional');
    expect(all[0]?.cvVariant).toBeUndefined();
  });

  it('builds a stable sha1-based job id from normalized fields', async () => {
    const repository = repo();
    await importApplicationHistory([row({ company: ' ACME Fictional ' })], { repository });
    const again = await importApplicationHistory([row()], { repository });
    const all = await repository.list();
    expect(again.alreadyImported).toBe(1);
    expect(all).toHaveLength(1);
    expect(all[0]?.jobId).toMatch(/^import-[0-9a-f]{16}$/);
  });

  it('skips rows without applied date, unknown status and blank titles', async () => {
    const repository = repo();
    const { appliedAt: _drop, ...noDate } = row();
    const result = await importApplicationHistory(
      [
        { ...noDate, rowNumber: 2 },
        row({ rowNumber: 3, status: 'Contratado' }),
        row({ rowNumber: 4, title: '  ' }),
      ],
      { repository },
    );
    expect(result.imported).toBe(0);
    expect(result.skipped.map((s) => s.rowNumber)).toEqual([2, 3, 4]);
    expect(result.skipped[0]?.reason).toBe('missing_applied_date');
    expect(result.skipped[1]?.reason).toMatch(/status/i);
    expect(await repository.list()).toEqual([]);
  });

  it('drops non-http urls without throwing', async () => {
    const repository = repo();
    await importApplicationHistory(
      [
        row({ rowNumber: 2, listNumber: '1', url: 'javascript:alert(1)' }),
        row({ rowNumber: 3, listNumber: '2', url: 'not a url' }),
        row({ rowNumber: 4, listNumber: '3', url: 'https://ok.test/a' }),
      ],
      { repository },
    );
    const urls = (await repository.list()).map((a) => a.listing?.url);
    expect(urls.filter((u) => u === undefined)).toHaveLength(2);
    expect(urls).toContain('https://ok.test/a');
  });

  it('is idempotent on re-import', async () => {
    const repository = repo();
    const rows = [row({ listNumber: '1' }), row({ listNumber: '2' })];
    await importApplicationHistory(rows, { repository });
    const again = await importApplicationHistory(rows, { repository });
    expect(again).toEqual({ imported: 0, alreadyImported: 2, skipped: [] });
    expect(await repository.list()).toHaveLength(2);
  });

  it('turns respondedAt into outcomeUpdatedAt, surviving the JSON round trip', async () => {
    await importApplicationHistory(
      [row({ status: 'Rechazado', respondedAt: new Date('2026-02-01T00:00:00Z') })],
      { repository: repo() },
    );
    const [application] = await repo().list();
    expect(application?.outcomeUpdatedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(application?.appliedAt.toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });

  it('defaults outcomeUpdatedAt to appliedAt when there is no respondedAt', async () => {
    const repository = repo();
    await importApplicationHistory([row()], { repository });
    const [application] = await repository.list();
    expect(application?.outcomeUpdatedAt).toEqual(application?.appliedAt);
  });

  it('counts imported rows in totals and by source but not per variant', async () => {
    const repository = repo();
    await importApplicationHistory([row()], { repository });
    const stats = computeApplicationStats(await repository.list());
    expect(stats.totalApplied).toBe(1);
    expect(stats.bySource.some((s) => s.sourceId === 'infojobs')).toBe(true);
    expect(stats.byVariant).toEqual([]);
  });
});

describe('createApplication outcomeUpdatedAt', () => {
  it('defaults to appliedAt for queue applications', () => {
    const appliedAt = new Date('2026-03-01T00:00:00Z');
    const application = createApplication({ jobId: 'j1', appliedAt, cvVariant: 'frontend', scoreAtApply: 10 });
    expect(application.outcomeUpdatedAt).toEqual(appliedAt);
  });

  it('honors an explicit outcomeUpdatedAt', () => {
    const at = new Date('2026-03-05T00:00:00Z');
    const application = createApplication({
      jobId: 'j1',
      appliedAt: new Date('2026-03-01T00:00:00Z'),
      outcomeUpdatedAt: at,
    });
    expect(application.outcomeUpdatedAt).toEqual(at);
  });
});
