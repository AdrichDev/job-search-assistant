import { type Job } from './job.js';
import { extractRequiredYears } from './scoring/seniority.js';
import { matchedTerms, normalizeText } from './text.js';

/**
 * FILTER B: is a first-job candidate plausibly eligible for this posting?
 *
 * This used to be a scoring DIMENSION (`seniorityFit`), where an unwelcoming
 * posting merely ranked lower. It is now a FILTER, because the candidate asked
 * for a list he can read top to bottom rather than a number he has to trust.
 *
 * THE ASYMMETRY, which is the entire design:
 *
 *   a junior job wrongly DROPPED  -> an opportunity he never learns exists.
 *                                    Invisible to him, invisible to us,
 *                                    permanent.
 *   a mid-level job wrongly SHOWN -> he reads eight words and scrolls past.
 *
 * Those two errors are not remotely equal, so the filter is not remotely
 * symmetric. It excludes ONLY on an explicit disqualifying signal:
 *
 *   1. a rank word in the TITLE that a zero-year candidate cannot hold, or
 *   2. a stated requirement of `maxYearsRequired` or more years.
 *
 * Anything else - including complete silence about seniority, which is the
 * single most common case in Spanish job ads - is INCLUDED. "Unclear" is not
 * evidence of anything, and guessing against the candidate is exactly the
 * behaviour he asked to be removed.
 *
 * Kept out of `scoring/` on purpose. Scoring answers "how good is this for
 * him"; this answers "is he allowed to apply at all". Merging them is how a
 * preference quietly becomes a deletion.
 */

export interface JuniorFilterConfig {
  /** Rank words checked against the title only. See the config for why. */
  readonly disqualifyingTitleTerms: readonly string[];
  /** Stated years at or above this count disqualify. */
  readonly maxYearsRequired: number;
}

export interface JuniorEligibility {
  readonly eligible: boolean;
  /** Always populated. An exclusion the candidate cannot read is one he cannot argue with. */
  readonly reason: string;
}

function formatYears(years: number): string {
  const amount = Number.isInteger(years) ? `${years}` : years.toFixed(1);
  return `${amount} year${years === 1 ? '' : 's'}`;
}

export function judgeJuniorEligibility(
  job: Job,
  config: JuniorFilterConfig,
): JuniorEligibility {
  const normalizedTitle = normalizeText(job.title);

  // Title first: it is the strongest and cheapest signal, and it is the one the
  // candidate would have used himself scrolling a results page.
  const rankSignals = matchedTerms(normalizedTitle, config.disqualifyingTitleTerms);
  if (rankSignals.length > 0) {
    return {
      eligible: false,
      reason: `title states a rank a first-job candidate cannot hold (${rankSignals.join(', ')})`,
    };
  }

  /*
   * Years are read from the whole posting, not just the title, because that is
   * where the requirement is actually written.
   *
   * `extractRequiredYears` is reused rather than reimplemented: it already
   * requires an experience noun next to the number, which is what stops
   * "23 dias de vacaciones al ano" from reading as a seniority requirement.
   * Two different parsers for the same sentence would eventually disagree, and
   * the chip in the UI would then contradict the filter that hid the job.
   */
  const years = extractRequiredYears(
    normalizeText(`${job.title} ${job.company} ${job.location} ${job.description}`),
  );

  if (years !== null && years >= config.maxYearsRequired) {
    return {
      eligible: false,
      reason: `asks for ${formatYears(years)} of experience`,
    };
  }

  if (years !== null) {
    return { eligible: true, reason: `asks for ${formatYears(years)} of experience` };
  }

  return {
    eligible: true,
    reason: 'no explicit disqualifying seniority signal - included so the candidate can judge',
  };
}
