import { ageInDays, clamp01 } from '../text.js';
import type { DimensionResult, RecencyConfig } from './types.js';

/**
 * Linear decay across the configured window.
 *
 * Linear rather than exponential on purpose: the point is a readable
 * "posted N days ago" story the candidate can sanity-check, not a curve.
 */
export function scoreRecency(postedAt: Date, now: Date, config: RecencyConfig): DimensionResult {
  const age = ageInDays(postedAt, now);
  const decayed = 1 - age / config.decayDays;
  const value = Math.max(config.floor, clamp01(decayed));
  const days = Math.round(age);

  return {
    value,
    reason: days === 0 ? 'posted today' : `posted ${days} day${days === 1 ? '' : 's'} ago`,
  };
}
