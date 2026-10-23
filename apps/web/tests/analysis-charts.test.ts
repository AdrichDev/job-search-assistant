import { describe, expect, it } from 'vitest';
import type { ApplicationStats } from '@job-queue/core/domain';
import {
  barLength,
  chartAriaLabel,
  funnelStages,
  percentLabel,
  truncateLabel,
} from '@/lib/analysis-charts';

/**
 * The geometry and wording of the analysis charts (U9).
 *
 * The charts are drawn from the SAME numbers the stats tables show, so the
 * arithmetic lives in one pure module and is tested here: the funnel order,
 * the rate carried from the previous stage, and a bar length that can never
 * overflow its track or invent a width for an empty value.
 */

const FULL_FUNNEL: ApplicationStats['funnel'] = {
  surfaced: 40,
  applied: 10,
  responses: 4,
  advances: 2,
  interviews: 1,
  offers: 0,
  applicationRate: 0.25,
  responseRate: 0.4,
  advanceRate: 0.5,
  interviewRate: 0.5,
  offerRate: 0,
};

describe('funnelStages', () => {
  it('lists the six stages in the order the stats panel shows them', () => {
    expect(funnelStages(FULL_FUNNEL).map((stage) => stage.key)).toEqual([
      'surfaced',
      'applied',
      'responses',
      'advances',
      'interviews',
      'offers',
    ]);
  });

  it('carries each count and its rate from the previous stage', () => {
    expect(funnelStages(FULL_FUNNEL)).toEqual([
      { key: 'surfaced', count: 40, rateFromPrevious: null },
      { key: 'applied', count: 10, rateFromPrevious: 0.25 },
      { key: 'responses', count: 4, rateFromPrevious: 0.4 },
      { key: 'advances', count: 2, rateFromPrevious: 0.5 },
      { key: 'interviews', count: 1, rateFromPrevious: 0.5 },
      { key: 'offers', count: 0, rateFromPrevious: 0 },
    ]);
  });

  it('keeps the zeros of an untouched funnel at zero, never NaN', () => {
    const empty: ApplicationStats['funnel'] = {
      surfaced: 0,
      applied: 0,
      responses: 0,
      advances: 0,
      interviews: 0,
      offers: 0,
      applicationRate: 0,
      responseRate: 0,
      advanceRate: 0,
      interviewRate: 0,
      offerRate: 0,
    };
    expect(funnelStages(empty)).toEqual([
      { key: 'surfaced', count: 0, rateFromPrevious: null },
      { key: 'applied', count: 0, rateFromPrevious: 0 },
      { key: 'responses', count: 0, rateFromPrevious: 0 },
      { key: 'advances', count: 0, rateFromPrevious: 0 },
      { key: 'interviews', count: 0, rateFromPrevious: 0 },
      { key: 'offers', count: 0, rateFromPrevious: 0 },
    ]);
  });
});

describe('percentLabel', () => {
  it('rounds to whole percents', () => {
    expect(percentLabel(0)).toBe('0%');
    expect(percentLabel(1)).toBe('100%');
    expect(percentLabel(0.4)).toBe('40%');
    expect(percentLabel(1 / 3)).toBe('33%');
  });

  it('never renders NaN for a non-finite rate', () => {
    expect(percentLabel(Number.NaN)).toBe('0%');
    expect(percentLabel(Number.POSITIVE_INFINITY)).toBe('0%');
  });
});

describe('barLength', () => {
  const TRACK = 250;

  it('proportional to the value within the track', () => {
    expect(barLength(10, 40, TRACK)).toBeCloseTo((10 / 40) * TRACK);
  });

  it('clamps the largest bar to the full track', () => {
    expect(barLength(40, 40, TRACK)).toBe(TRACK);
  });

  it('is zero for a zero value, a zero maximum or a non-finite input', () => {
    expect(barLength(0, 40, TRACK)).toBe(0);
    expect(barLength(10, 0, TRACK)).toBe(0);
    expect(barLength(Number.NaN, 40, TRACK)).toBe(0);
    expect(barLength(10, 40, Number.NaN)).toBe(0);
  });
});

describe('truncateLabel', () => {
  it('keeps a short label untouched', () => {
    expect(truncateLabel('Greenhouse')).toBe('Greenhouse');
  });

  it('cuts a long model name to one line with an ellipsis', () => {
    const truncated = truncateLabel('Carta de presentación base (Español)');
    expect(truncated.endsWith('…')).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(24);
    expect(truncated.startsWith('Carta')).toBe(true);
  });
});

describe('chartAriaLabel', () => {
  it('names the chart and reads every row as text', () => {
    expect(
      chartAriaLabel('Por fuente', [
        { key: 'greenhouse', label: 'Greenhouse', value: 12 },
        { key: 'ashby', label: 'Ashby', value: 3 },
      ]),
    ).toBe('Por fuente: Greenhouse 12, Ashby 3');
  });
});
