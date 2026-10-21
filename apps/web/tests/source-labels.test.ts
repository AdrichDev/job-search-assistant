import { describe, expect, it } from 'vitest';
import {
  entrySourceIds,
  entrySourceLabels,
  matchesSource,
  sourceLabel,
  sourceOptions,
  type SourcedEntry,
} from '@/lib/source-labels';

const entry = (...ids: string[]): SourcedEntry => ({
  sources: ids.map((sourceId, i) => ({ sourceId, externalId: String(i), url: `https://x.test/${i}` })),
});

describe('sourceLabel', () => {
  it('gives stable human labels to known ids', () => {
    expect(sourceLabel('greenhouse')).toBe('Greenhouse');
    expect(sourceLabel('fixture')).toBe('Ejemplo (catálogo)');
  });

  it('falls back visibly for unknown ids instead of claiming a portal', () => {
    expect(sourceLabel('infojobs')).toBe('Fuente desconocida (infojobs)');
    expect(sourceLabel('')).toBe('Fuente desconocida');
  });
});

describe('entrySourceIds / entrySourceLabels', () => {
  it('deduplicates repeated sources keeping first-seen order', () => {
    const e = entry('lever', 'greenhouse', 'lever');
    expect(entrySourceIds(e)).toEqual(['lever', 'greenhouse']);
    expect(entrySourceLabels(e)).toEqual(['Lever', 'Greenhouse']);
  });

  it('keeps every source of a multi-source entry', () => {
    expect(entrySourceLabels(entry('greenhouse', 'manfred'))).toHaveLength(2);
  });

  it('returns nothing for an entry without sources', () => {
    expect(entrySourceLabels(entry())).toEqual([]);
  });
});

describe('sourceOptions', () => {
  it('counts each entry once per source, including multi-source entries', () => {
    const entries = [entry('lever'), entry('lever', 'greenhouse'), entry('greenhouse', 'greenhouse'), entry('zzz')];
    expect(sourceOptions(entries)).toEqual([
      { id: 'greenhouse', label: 'Greenhouse', count: 2 },
      { id: 'lever', label: 'Lever', count: 2 },
      { id: 'zzz', label: 'Fuente desconocida (zzz)', count: 1 },
    ]);
  });

  it('is empty for an empty queue', () => {
    expect(sourceOptions([])).toEqual([]);
  });
});

describe('matchesSource', () => {
  it('matches "all" always and any one of several sources otherwise', () => {
    const e = entry('lever', 'greenhouse');
    expect(matchesSource(e, 'all')).toBe(true);
    expect(matchesSource(e, 'greenhouse')).toBe(true);
    expect(matchesSource(e, 'lever')).toBe(true);
    expect(matchesSource(e, 'manfred')).toBe(false);
  });
});
