import {
  isAdvance,
  isResponse,
  type Application,
  type ApplicationOutcome,
} from './application.js';
import type { CvVariant } from './job.js';

/**
 * The payoff of the whole tracking layer: "does my Microsoft CV convert better
 * than my React one?".
 *
 * Pure aggregation over the application log. No I/O, no clock.
 */

export interface VariantStats {
  readonly cvVariant: CvVariant;
  readonly applied: number;
  /** Any reply at all, rejections included. */
  readonly responses: number;
  /** Replies that moved forward: screening, interview, offer. */
  readonly advances: number;
  readonly responseRate: number;
  readonly advanceRate: number;
}

export interface SourceStats {
  /** Source adapter id, or `unknown` for applications recorded before source tracking. */
  readonly sourceId: string;
  readonly applied: number;
  readonly responses: number;
  readonly advances: number;
  readonly responseRate: number;
  readonly advanceRate: number;
}

export interface ApplicationFunnel {
  readonly surfaced: number;
  readonly applied: number;
  readonly responses: number;
  readonly advances: number;
  readonly interviews: number;
  readonly offers: number;
  readonly applicationRate: number;
  readonly responseRate: number;
  readonly advanceRate: number;
  readonly interviewRate: number;
  readonly offerRate: number;
}

export interface ApplicationStatsContext {
  /** Unique vacancies ever surfaced across the current queue and durable logs. */
  readonly surfaced: number;
}

export interface ApplicationStats {
  readonly totalApplied: number;
  readonly responses: number;
  readonly advances: number;
  /** Sent, still waiting for any answer. */
  readonly pending: number;
  readonly responseRate: number;
  readonly advanceRate: number;
  readonly byOutcome: Readonly<Record<ApplicationOutcome, number>>;
  /** Only variants actually used, most-used first. */
  readonly byVariant: readonly VariantStats[];
  /** Each source that carried a vacancy gets credit; legacy rows use `unknown`. */
  readonly bySource: readonly SourceStats[];
  readonly funnel: ApplicationFunnel;
}

/** Rates are 0 for an empty denominator: the UI must never render `NaN%`. */
function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/** A literal, not a loop: adding an outcome without a counter is a compile error. */
function emptyOutcomeTally(): Record<ApplicationOutcome, number> {
  return { applied: 0, no_reply: 0, rejected: 0, screening: 0, interview: 0, offer: 0 };
}

interface VariantAccumulator {
  applied: number;
  responses: number;
  advances: number;
}

export function computeApplicationStats(
  applications: readonly Application[],
  context?: ApplicationStatsContext,
): ApplicationStats {
  const byOutcome = emptyOutcomeTally();
  const variants = new Map<CvVariant, VariantAccumulator>();
  const sources = new Map<string, VariantAccumulator>();

  let responses = 0;
  let advances = 0;
  let pending = 0;

  for (const application of applications) {
    byOutcome[application.outcome] += 1;

    const responded = isResponse(application.outcome);
    const advanced = isAdvance(application.outcome);

    if (responded) {
      responses += 1;
    }
    if (advanced) {
      advances += 1;
    }
    if (application.outcome === 'applied') {
      pending += 1;
    }

    const accumulator = variants.get(application.cvVariant) ?? {
      applied: 0,
      responses: 0,
      advances: 0,
    };
    accumulator.applied += 1;
    accumulator.responses += responded ? 1 : 0;
    accumulator.advances += advanced ? 1 : 0;
    variants.set(application.cvVariant, accumulator);

    // A deduped vacancy can carry several source refs. Each source gets credit:
    // the question is "does this source lead to replies?", not "which source won?".
    const sourceIds = application.sourceIds.length === 0 ? ['unknown'] : application.sourceIds;
    for (const sourceId of sourceIds) {
      const source = sources.get(sourceId) ?? { applied: 0, responses: 0, advances: 0 };
      source.applied += 1;
      source.responses += responded ? 1 : 0;
      source.advances += advanced ? 1 : 0;
      sources.set(sourceId, source);
    }
  }

  const totalApplied = applications.length;

  const byVariant = [...variants.entries()]
    .map(([cvVariant, accumulator]) => ({
      cvVariant,
      applied: accumulator.applied,
      responses: accumulator.responses,
      advances: accumulator.advances,
      responseRate: rate(accumulator.responses, accumulator.applied),
      advanceRate: rate(accumulator.advances, accumulator.applied),
    }))
    // Most-used variant first; the name breaks ties so the panel is stable.
    .sort((a, b) =>
      b.applied !== a.applied ? b.applied - a.applied : a.cvVariant.localeCompare(b.cvVariant),
    );

  const surfaced = Math.max(context?.surfaced ?? totalApplied, totalApplied);
  const interviews = byOutcome.interview + byOutcome.offer;
  const offers = byOutcome.offer;
  const funnel: ApplicationFunnel = {
    surfaced,
    applied: totalApplied,
    responses,
    advances,
    interviews,
    offers,
    applicationRate: rate(totalApplied, surfaced),
    responseRate: rate(responses, totalApplied),
    advanceRate: rate(advances, responses),
    interviewRate: rate(interviews, advances),
    offerRate: rate(offers, interviews),
  };

  const bySource = [...sources.entries()]
    .map(([sourceId, accumulator]) => ({
      sourceId,
      applied: accumulator.applied,
      responses: accumulator.responses,
      advances: accumulator.advances,
      responseRate: rate(accumulator.responses, accumulator.applied),
      advanceRate: rate(accumulator.advances, accumulator.applied),
    }))
    .sort((a, b) =>
      b.applied !== a.applied ? b.applied - a.applied : a.sourceId.localeCompare(b.sourceId),
    );

  return {
    totalApplied,
    responses,
    advances,
    pending,
    responseRate: rate(responses, totalApplied),
    advanceRate: rate(advances, totalApplied),
    byOutcome,
    byVariant,
    bySource,
    funnel,
  };
}
