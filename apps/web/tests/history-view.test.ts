import { describe, expect, it } from 'vitest';
import {
  HISTORY_FIELDS,
  type ApplicationChange,
} from '@job-queue/core';
import { ES } from '@/copy/es';
import { describeChangeValue, formatHistoryDate, historyFieldLabel } from '@/components/history-format';
import { loadApplicationHistory } from '@/server/history';
import { createStubHistory } from './helpers/stub-repository';

const JOB = 'import-aaaa1111';

function entry(id: string, at: string, extra: Partial<ApplicationChange> = {}): ApplicationChange {
  return {
    id,
    jobId: JOB,
    at: new Date(at),
    source: 'manual',
    changes: [{ field: 'notes', before: null, after: id }],
    ...extra,
  };
}

describe('loadApplicationHistory', () => {
  it('is an empty list (not a warning) for an application with no history', async () => {
    expect(await loadApplicationHistory(JOB, { historyRepository: createStubHistory([]) })).toEqual({
      entries: [],
      warning: null,
    });
  });

  it('marks the undoable and the reverted entries, newest first', async () => {
    const data = await loadApplicationHistory(JOB, {
      historyRepository: createStubHistory([
        entry('r1', '2026-04-03T10:00:00Z', { source: 'revert', revertsId: 'e2' }),
        entry('e2', '2026-04-02T10:00:00Z'),
        entry('e1', '2026-04-01T10:00:00Z'),
      ]),
    });
    expect(data.warning).toBeNull();
    expect(data.entries.map((e) => [e.id, e.reverted, e.undoable])).toEqual([
      ['r1', false, true],
      ['e2', true, false],
      ['e1', false, true],
    ]);
  });

  it('degrades a failing history to a warning instead of throwing', async () => {
    const data = await loadApplicationHistory(JOB, { historyRepository: createStubHistory([], { failReads: true }) });
    expect(data.entries).toEqual([]);
    expect(data.warning).toContain('not valid JSON');
  });

  it('degrades to a warning when no history store is configured', async () => {
    const data = await loadApplicationHistory(JOB, {});
    expect(data.entries).toEqual([]);
    expect(data.warning).not.toBeNull();
  });
});

describe('history display helpers', () => {
  it('has a Spanish label for every loggable field', () => {
    for (const field of HISTORY_FIELDS) {
      const label = historyFieldLabel(field);
      expect(label, field).not.toBe(field);
      expect(label).not.toContain('.');
      expect(label).not.toContain('listing');
    }
  });

  it('shows empty values as "vacío"', () => {
    expect(describeChangeValue('notes', null)).toEqual({ text: ES.history.emptyValue, empty: true });
    expect(describeChangeValue('sourceIds', [])).toEqual({ text: ES.history.emptyValue, empty: true });
    expect(describeChangeValue('listing.city', '')).toEqual({ text: ES.history.emptyValue, empty: true });
  });

  it('translates outcomes and CV variants and formats dates in Spain time', () => {
    expect(describeChangeValue('outcome', 'rejected').text).toBe(ES.outcomeOption.rejected);
    expect(describeChangeValue('cvVariant', 'frontend').text).toContain('CV');
    expect(describeChangeValue('appliedAt', '2026-03-01T00:00:00.000Z').text).toMatch(/1 mar 2026/);
    expect(describeChangeValue('sourceIds', ['infojobs', 'linkedin']).text).toBe('infojobs, linkedin');
  });

  it('truncates long values for display only', () => {
    const long = 'Ñ'.repeat(20_000);
    const shown = describeChangeValue('notes', long);
    expect(shown.text.length).toBeLessThan(200);
    expect(shown.text.endsWith('…')).toBe(true);
    expect(shown.truncated).toBe(true);
    expect(describeChangeValue('notes', 'corta').truncated).toBeUndefined();
  });

  it('formats an entry date with the hour, in Europe/Madrid', () => {
    // 22:30 UTC on 30 June is already 00:30 on 1 July in Madrid (summer time).
    expect(formatHistoryDate(new Date('2026-06-30T22:30:00Z'))).toMatch(/1 jul 2026.*00:30/);
  });
});
