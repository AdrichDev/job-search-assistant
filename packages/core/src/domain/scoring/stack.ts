import type { CvVariant } from '../job.js';
import { clamp01, matchedTerms } from '../text.js';
import type { DimensionResult, StackConfig, StackLaneConfig } from './types.js';

export interface StackMatchResult extends DimensionResult {
  /** Winning lane. Drives which CV variant the tailoring layer will use. */
  readonly cvVariant: CvVariant;
  readonly matchedKeywords: readonly string[];
}

interface LaneEvaluation {
  readonly lane: StackLaneConfig;
  readonly hits: readonly string[];
  readonly value: number;
}

/**
 * Affinity with the candidate's two real lanes, plus a shared general bucket.
 *
 * Deliberately NOT a filter. A posting with zero recognizable technology scores
 * 0 on this dimension but still reaches the output - the other dimensions may
 * well carry it.
 */
export function scoreStack(normalizedText: string, config: StackConfig): StackMatchResult {
  const generalHits = matchedTerms(normalizedText, config.generalKeywords);
  const generalScore = clamp01(generalHits.length / config.generalSaturation);

  const evaluations: LaneEvaluation[] = config.lanes.map((lane) => {
    const hits = matchedTerms(normalizedText, lane.keywords);
    const laneScore = clamp01(hits.length / config.laneSaturation);
    return {
      lane,
      hits,
      value: config.laneShare * laneScore + config.generalShare * generalScore,
    };
  });

  // Ties are broken by config order, which keeps the ranking deterministic.
  const best = evaluations.reduce<LaneEvaluation | null>((winner, current) => {
    if (winner === null) {
      return current;
    }
    return current.value > winner.value ? current : winner;
  }, null);

  if (best === null || best.hits.length === 0) {
    const value = clamp01(config.generalOnlyShare * generalScore);
    return {
      value,
      cvVariant: 'general',
      matchedKeywords: generalHits,
      reason:
        generalHits.length > 0
          ? `general lane: ${generalHits.join(', ')}`
          : 'no recognizable technology in the posting',
    };
  }

  const matchedKeywords = [...best.hits, ...generalHits];
  const generalNote = generalHits.length > 0 ? ` + general: ${generalHits.join(', ')}` : '';

  return {
    value: clamp01(best.value),
    cvVariant: best.lane.id,
    matchedKeywords,
    reason: `${best.lane.label} lane: ${best.hits.join(', ')}${generalNote}`,
  };
}
