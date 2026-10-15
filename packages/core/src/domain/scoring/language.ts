import { containsTerm, matchedTerms } from '../text.js';
import type { DimensionResult, LanguageConfig } from './types.js';

/**
 * Heuristic "is this posting written entirely in English?".
 *
 * Stopword counting rather than a language-detection dependency: a single
 * Spanish function word is enough to prove the ad is not English-only, which is
 * exactly the signal we need and costs nothing.
 */
export function detectEnglishOnly(normalizedText: string, config: LanguageConfig): boolean {
  const tokens = new Set(normalizedText.split(' '));
  const spanishHits = config.spanishStopwords.filter((word) => tokens.has(word)).length;
  if (spanishHits > 0) {
    return false;
  }
  const englishHits = config.englishStopwords.filter((word) => tokens.has(word)).length;
  return englishHits >= config.englishOnlyMinHits;
}

/**
 * B1 is a hard ceiling for this candidate, so anything above it is a real risk.
 *
 * This never returns 0: a C2 requirement down-ranks a posting, it does not
 * delete it. Job ads routinely overstate language needs.
 */
export function scoreLanguage(
  normalizedText: string,
  englishOnly: boolean,
  config: LanguageConfig,
): DimensionResult {
  const high = matchedTerms(normalizedText, config.highEnglishTerms);
  if (high.length > 0) {
    return {
      value: config.scores.high,
      reason: `demands English above B1 (${high.join(', ')})`,
    };
  }

  const medium = matchedTerms(normalizedText, config.mediumEnglishTerms);
  if (medium.length > 0) {
    return { value: config.scores.medium, reason: `asks for English ${medium[0]}` };
  }

  if (englishOnly) {
    return {
      value: config.scores.englishOnly,
      reason: 'posting written entirely in English',
    };
  }

  const friendly = config.friendlyTerms.filter((term) => containsTerm(normalizedText, term));
  if (friendly.length > 0) {
    return { value: config.scores.friendly, reason: `English requirement within reach (${friendly[0]})` };
  }

  return { value: config.scores.neutral, reason: 'no explicit English requirement' };
}
