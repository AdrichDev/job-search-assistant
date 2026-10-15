import { type Job, jobSearchText } from '../job.js';
import { normalizeText } from '../text.js';
import { detectEnglishOnly, scoreLanguage } from './language.js';
import { scoreLocation } from './location.js';
import { scoreRecency } from './recency.js';
import { scoreSeniority } from './seniority.js';
import { scoreSoftwareRelevance } from './software-relevance.js';
import { scoreStack } from './stack.js';
import {
  SCORE_DIMENSIONS,
  type DimensionResult,
  type ScoreBreakdownItem,
  type ScoreDimension,
  type ScoredJob,
  type ScoringConfig,
} from './types.js';

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Combines every dimension into a 0..100 score with a full audit trail.
 *
 * Two different mechanisms are at work here and the distinction is the whole
 * point of this function:
 *
 * 1. The five WEIGHTED dimensions are additive. Weights are normalized by their
 *    own sum, so editing one weight never silently rescales the ranking. This
 *    produces `totalBeforeGate`.
 * 2. Software relevance is a MULTIPLIER, not a sixth weighted dimension.
 *    Raising `stackMatch`'s weight would only have moved the threshold at which
 *    a dentist outranks a developer; multiplying by zero removes the question.
 */
export function scoreJob(job: Job, config: ScoringConfig, now: Date): ScoredJob {
  const normalizedTitle = normalizeText(job.title);
  const normalizedLocation = normalizeText(job.location);
  const normalizedBody = normalizeText(`${job.company} ${job.location} ${job.description}`);
  const normalizedText = jobSearchText(job);

  const englishOnly = detectEnglishOnly(normalizedText, config.language);
  const stack = scoreStack(normalizedText, config.stack);

  const results: Record<ScoreDimension, DimensionResult> = {
    seniorityFit: scoreSeniority({ normalizedTitle, normalizedBody }, config.seniority),
    stackMatch: stack,
    locationFit: scoreLocation(
      { normalizedLocation, normalizedText, englishOnly },
      config.location,
    ),
    languageFit: scoreLanguage(normalizedText, englishOnly, config.language),
    recency: scoreRecency(job.postedAt, now, config.recency),
  };

  const totalWeight = SCORE_DIMENSIONS.reduce(
    (sum, dimension) => sum + config.weights[dimension],
    0,
  );
  const safeTotalWeight = totalWeight === 0 ? 1 : totalWeight;

  let rawTotal = 0;
  const breakdown: ScoreBreakdownItem[] = SCORE_DIMENSIONS.map((dimension) => {
    const weight = config.weights[dimension];
    const result = results[dimension];
    const contribution = (result.value * weight * 100) / safeTotalWeight;
    rawTotal += contribution;

    return {
      dimension,
      value: round(result.value, 4),
      weight,
      contribution: round(contribution, 2),
      reason: result.reason,
    };
  });

  const totalBeforeGate = round(rawTotal, 1);

  const relevance = scoreSoftwareRelevance(
    { normalizedTitle, normalizedText },
    config.softwareRelevance,
  );
  // Reported and applied value must be the same number, or the printed
  // breakdown would not reproduce the printed total.
  const relevanceValue = round(relevance.value, 4);

  return {
    job,
    score: {
      total: round(totalBeforeGate * relevanceValue, 1),
      totalBeforeGate,
      softwareRelevance: {
        value: relevanceValue,
        isSoftware: relevance.isSoftware,
        reason: relevance.reason,
      },
      cvVariant: stack.cvVariant,
      breakdown,
    },
  };
}
