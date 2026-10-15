import { matchedTerms } from '../text.js';
import type { DimensionResult, LocationConfig } from './types.js';

export interface LocationInput {
  readonly normalizedLocation: string;
  /** Location + title + description, normalized. Remote/hybrid wording often lives in the body. */
  readonly normalizedText: string;
  /** Computed once by the language dimension and shared, to keep both consistent. */
  readonly englishOnly: boolean;
}

/**
 * Commuting reality for someone based in Madrid with a car.
 *
 * Order matters: an explicit Madrid mention beats any remote wording, because a
 * hybrid Madrid role is strictly better than an undefined remote one.
 */
export function scoreLocation(input: LocationInput, config: LocationConfig): DimensionResult {
  const { normalizedText, englishOnly } = input;

  const primary = matchedTerms(normalizedText, config.primaryTerms);
  if (primary.length > 0) {
    return { value: config.scores.primary, reason: 'based in Madrid' };
  }

  const metro = matchedTerms(normalizedText, config.metroTerms);
  if (metro.length > 0) {
    return { value: config.scores.metro, reason: `Madrid metro area (${metro[0]})` };
  }

  const remote = [
    ...matchedTerms(normalizedText, config.remoteTerms),
    ...matchedTerms(normalizedText, config.hybridTerms),
  ];

  if (remote.length > 0) {
    const country = matchedTerms(normalizedText, config.countryTerms);
    if (country.length > 0) {
      return { value: config.scores.remoteSpain, reason: 'remote or hybrid within Spain' };
    }
    if (englishOnly) {
      return {
        value: config.scores.remoteGlobalEnglish,
        reason: 'remote but English-first and not scoped to Spain',
      };
    }
    return { value: config.scores.remoteUnspecified, reason: 'remote, country not stated' };
  }

  const otherCity = matchedTerms(normalizedText, config.otherCityTerms);
  if (otherCity.length > 0) {
    return {
      value: config.scores.otherSpanishCity,
      reason: `on-site outside Madrid (${otherCity[0]})`,
    };
  }

  return { value: config.scores.unknown, reason: 'location not recognized' };
}
