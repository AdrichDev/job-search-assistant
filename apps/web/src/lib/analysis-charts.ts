import type { ApplicationStats } from '@job-queue/core/domain';

/** The funnel as the stats module computes it, referenced through `ApplicationStats` so the core's public exports stay untouched. */
type ApplicationFunnel = ApplicationStats['funnel'];

/**
 * Pure geometry and wording for the analysis charts (S9).
 *
 * The charts on /analisis are drawn from the SAME numbers the stats tables
 * show. This module owns every figure they add - the funnel order, the rate
 * carried from the previous stage, bar lengths - so a chart can never drift
 * into a second arithmetic that disagrees with the tables underneath it.
 *
 * Meaning is never encoded by colour alone: every row also carries its value
 * as text next to the bar, which is what makes the chart its own readable
 * fallback.
 */

/** One bar of a chart: a row of the source data plus its already-worded detail. */
export interface ChartRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Extra text after the value (a rate, a denominator); plain words, never colour. */
  readonly detail?: string;
}

export type FunnelKey =
  | 'surfaced'
  | 'applied'
  | 'responses'
  | 'advances'
  | 'interviews'
  | 'offers';
export interface FunnelStage {
  readonly key: FunnelKey;
  readonly count: number;
  /** Rate from the previous stage, as the funnel already computed it. Null for the first stage. */
  readonly rateFromPrevious: number | null;
}

/**
 * The six funnel stages, in the fixed order the stats panel shows them.
 * The keys are the stable names the copy labels each stage with.
 */
export function funnelStages(funnel: ApplicationFunnel): readonly FunnelStage[] {
  return [
    { key: 'surfaced', count: funnel.surfaced, rateFromPrevious: null },
    { key: 'applied', count: funnel.applied, rateFromPrevious: funnel.applicationRate },
    { key: 'responses', count: funnel.responses, rateFromPrevious: funnel.responseRate },
    { key: 'advances', count: funnel.advances, rateFromPrevious: funnel.advanceRate },
    { key: 'interviews', count: funnel.interviews, rateFromPrevious: funnel.interviewRate },
    { key: 'offers', count: funnel.offers, rateFromPrevious: funnel.offerRate },
  ];
}

/** Whole percents, and never NaN: the UI must not render "NaN%" the way it must not render NaN rates. */
export function percentLabel(rate: number): string {
  if (!Number.isFinite(rate)) {
    return '0%';
  }
  return `${Math.round(rate * 100)}%`;
}

/**
 * Length of one bar inside its track, clamped to it.
 *
 * The largest value fills the track exactly; a zero value, a zero maximum or
 * any non-finite input draws nothing rather than inventing a width.
 */
export function barLength(value: number, max: number, track: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || !Number.isFinite(track)) {
    return 0;
  }
  if (track <= 0 || max <= 0 || value <= 0) {
    return 0;
  }
  return Math.min(1, value / max) * track;
}

/** Accessible name of a chart: its title plus every row read out as text. */
export function chartAriaLabel(title: string, rows: readonly ChartRow[]): string {
  const described = rows.map((row) => `${row.label} ${row.value}`).join(', ');
  return `${title}: ${described}`;
}
