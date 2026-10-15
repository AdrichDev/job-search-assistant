import {
  APPLICATION_OUTCOMES,
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
}

/** Rates are 0 for an empty denominator: the UI must never render `NaN%`. */
function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function emptyOutcomeTally(): Record<ApplicationOutcome, number> {
  const tally = {} as Record<ApplicationOutcome, number>;
  for (const outcome of APPLICATION_OUTCOMES) {
    tally[outcome] = 0;
  }
  return tally;
}

interface VariantAccumulator {
  applied: number;
  responses: number;
  advances: number;
}

export function computeApplicationStats(
  applications: readonly Application[],
): ApplicationStats {
  const byOutcome = emptyOutcomeTally();
  const variants = new Map<CvVariant, VariantAccumulator>();

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

  return {
    totalApplied,
    responses,
    advances,
    pending,
    responseRate: rate(responses, totalApplied),
    advanceRate: rate(advances, totalApplied),
    byOutcome,
    byVariant,
  };
}
