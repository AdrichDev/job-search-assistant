import { describe, expect, it } from 'vitest';
import { surfaceWithExploration } from '../../src/domain/exploration.js';

/** Ranked list stand-in: index 0 is the best-scoring entry. */
function ranked(size: number): readonly number[] {
  return Array.from({ length: size }, (_, index) => index);
}

function surface(size: number, limit: number, rate: number, seed = 'seed-a') {
  return surfaceWithExploration(ranked(size), { limit, rate, seed });
}

describe('surfaceWithExploration', () => {
  it('surfaces exactly `limit` entries when the pool is large enough', () => {
    expect(surface(100, 20, 0.15)).toHaveLength(20);
  });

  it('never invents entries when there are fewer jobs than the limit', () => {
    expect(surface(4, 20, 0.15)).toHaveLength(4);
  });

  it('reserves the configured share of slots for exploration', () => {
    const surfaced = surface(100, 20, 0.15);
    expect(surfaced.filter((entry) => entry.exploration)).toHaveLength(3);
  });

  it('takes exploration entries from OUTSIDE the exploited top band', () => {
    const surfaced = surface(100, 20, 0.15);
    const exploitedCount = surfaced.filter((entry) => !entry.exploration).length;

    for (const entry of surfaced) {
      if (entry.exploration) {
        expect(entry.item).toBeGreaterThanOrEqual(exploitedCount);
      }
    }
  });

  it('keeps the whole top band: no high-ranked job is displaced by exploration', () => {
    const surfaced = surface(100, 20, 0.15);
    const exploited = surfaced.filter((entry) => !entry.exploration).map((entry) => entry.item);
    expect(exploited).toEqual([...Array(17).keys()]);
  });

  it('is deterministic for the same seed', () => {
    const a = surface(100, 20, 0.15, 'run-2026-09-07');
    const b = surface(100, 20, 0.15, 'run-2026-09-07');
    expect(b).toEqual(a);
  });

  it('produces a different sample for a different seed', () => {
    const a = surface(100, 20, 0.15, 'seed-a').filter((entry) => entry.exploration);
    const b = surface(100, 20, 0.15, 'seed-b').filter((entry) => entry.exploration);
    expect(b).not.toEqual(a);
  });

  it('spreads exploration entries through the list instead of dumping them at the bottom', () => {
    const surfaced = surface(200, 20, 0.15);
    const positions = surfaced
      .map((entry, index) => (entry.exploration ? index : -1))
      .filter((index) => index >= 0);

    expect(positions.every((index) => index > 0 && index < surfaced.length - 1)).toBe(true);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('never surfaces the same job twice', () => {
    const items = surface(100, 20, 0.15).map((entry) => entry.item);
    expect(new Set(items).size).toBe(items.length);
  });

  it('disables exploration cleanly at rate 0', () => {
    const surfaced = surface(100, 20, 0);
    expect(surfaced.some((entry) => entry.exploration)).toBe(false);
    expect(surfaced.map((entry) => entry.item)).toEqual([...Array(20).keys()]);
  });

  it('clamps a nonsensical rate instead of throwing', () => {
    expect(surface(100, 10, 5)).toHaveLength(10);
    expect(surface(100, 10, -3).some((entry) => entry.exploration)).toBe(false);
  });

  it('returns nothing for a zero limit', () => {
    expect(surface(100, 0, 0.15)).toEqual([]);
  });

  it('handles an empty ranking', () => {
    expect(surfaceWithExploration([], { limit: 10, rate: 0.15, seed: 's' })).toEqual([]);
  });

  it('keeps exploration picks in their original ranked order relative to each other', () => {
    const explored = surface(100, 20, 0.15)
      .filter((entry) => entry.exploration)
      .map((entry) => entry.item);
    expect([...explored].sort((a, b) => a - b)).toEqual(explored);
  });
});
