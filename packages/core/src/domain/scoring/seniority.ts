import { clamp01, matchedTerms } from '../text.js';
import type { DimensionResult, SeniorityConfig } from './types.js';

export interface SeniorityInput {
  /** Already normalized job title. */
  readonly normalizedTitle: string;
  /** Already normalized company + location + description. */
  readonly normalizedBody: string;
}

/** A signal found in the title is stronger than the same signal buried in the body. */
const BODY_SIGNAL_WEIGHT = 0.6;
const BODY_PENALTY_WEIGHT = 0.55;

const MONTHS_PER_YEAR = 12;

/**
 * "3 años de experiencia" -> 3. "Experiencia mínima de 5 años" -> 5.
 *
 * Both regexes require an experience noun near the number, which is what stops
 * "23 días de vacaciones al año" or "desde 2026" from being read as a
 * seniority requirement. Text is expected to be accent-stripped already, hence
 * `anos?` rather than `años?`.
 */
const YEARS_BEFORE_NOUN = /(\d{1,2})\s*\+?\s*(?:anos?|years?)\b[^.;]{0,25}?experien/g;
const YEARS_AFTER_NOUN = /experien[a-z]*[^.;]{0,25}?(\d{1,2})\s*\+?\s*(?:anos?|years?)\b/g;
const MONTHS_BEFORE_NOUN = /(\d{1,2})\s*\+?\s*(?:meses|mes|months?)\b[^.;]{0,25}?experien/g;
const MONTHS_AFTER_NOUN = /experien[a-z]*[^.;]{0,25}?(\d{1,2})\s*\+?\s*(?:meses|mes|months?)\b/g;

function collectMatches(text: string, pattern: RegExp, divisor: number): number[] {
  const found: number[] = [];
  // `matchAll` needs a fresh lastIndex; the patterns are module-level constants.
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(raw)) {
      found.push(raw / divisor);
    }
  }
  return found;
}

/**
 * Years of experience the posting demands, or `null` when it stays silent.
 *
 * When a range is stated ("entre 3 y 5 años") the upper bound wins, because the
 * upper bound is what filters the candidate out.
 */
export function extractRequiredYears(normalizedText: string): number | null {
  const candidates = [
    ...collectMatches(normalizedText, YEARS_BEFORE_NOUN, 1),
    ...collectMatches(normalizedText, YEARS_AFTER_NOUN, 1),
    ...collectMatches(normalizedText, MONTHS_BEFORE_NOUN, MONTHS_PER_YEAR),
    ...collectMatches(normalizedText, MONTHS_AFTER_NOUN, MONTHS_PER_YEAR),
  ];

  if (candidates.length === 0) {
    return null;
  }
  return Math.max(...candidates);
}

function formatYears(years: number): string {
  const amount = Number.isInteger(years) ? `${years}` : years.toFixed(1);
  return `${amount} year${years === 1 ? '' : 's'}`;
}

/**
 * How plausible it is that a junior candidate is even eligible.
 *
 * This is the heaviest dimension in the default config: stack affinity is
 * worthless if the posting demands five years of experience.
 */
export function scoreSeniority(
  input: SeniorityInput,
  config: SeniorityConfig,
): DimensionResult {
  const { normalizedTitle, normalizedBody } = input;
  const combined = `${normalizedTitle} ${normalizedBody}`;

  const juniorInTitle = matchedTerms(normalizedTitle, config.juniorTerms);
  const juniorInBody = matchedTerms(normalizedBody, config.juniorTerms);
  const seniorInTitle = matchedTerms(normalizedTitle, config.seniorTerms);
  const seniorInBody = matchedTerms(normalizedBody, config.seniorTerms);
  const years = extractRequiredYears(combined);

  const reasons: string[] = [];
  let value = config.baseline;

  if (juniorInTitle.length > 0) {
    value += config.juniorTermBoost;
    reasons.push(`junior signal in title (${juniorInTitle.join(', ')})`);
  } else if (juniorInBody.length > 0) {
    value += config.juniorTermBoost * BODY_SIGNAL_WEIGHT;
    reasons.push(`junior signal in description (${juniorInBody.join(', ')})`);
  }

  if (seniorInTitle.length > 0) {
    value -= config.seniorTermPenalty;
    reasons.push(`senior signal in title (${seniorInTitle.join(', ')})`);
  } else if (seniorInBody.length > 0) {
    value -= config.seniorTermPenalty * BODY_PENALTY_WEIGHT;
    reasons.push(`senior signal in description (${seniorInBody.join(', ')})`);
  }

  if (years !== null) {
    if (years <= config.juniorYearsThreshold) {
      value += config.juniorYearsBoost;
      reasons.push(`asks for only ${formatYears(years)} of experience`);
    } else if (years < config.seniorYearsThreshold) {
      value -= config.midYearsPenalty;
      reasons.push(`asks for ${formatYears(years)} of experience`);
    } else {
      value -= config.seniorYearsPenalty;
      reasons.push(`asks for ${formatYears(years)} of experience`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('no explicit seniority signal');
  }

  return { value: clamp01(value), reason: reasons.join('; ') };
}
