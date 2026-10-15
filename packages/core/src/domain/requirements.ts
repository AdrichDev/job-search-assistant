import { type Job, jobSearchText } from './job.js';
import { extractRequiredYears } from './scoring/seniority.js';
import { scoreStack } from './scoring/stack.js';
import type { ScoringConfig } from './scoring/types.js';
import { matchedTerms, normalizeText } from './text.js';
import type { CvVariant } from './job.js';

/**
 * Structured, displayable signals derived from a posting.
 *
 * Exists so the UI can render chips the candidate can scan in a second,
 * instead of a wall of raw description text.
 *
 * Every keyword list comes from `ScoringConfig` and every parser is the one
 * scoring already uses - this module owns no vocabulary of its own, so tuning
 * the config keeps the chips and the score telling the same story.
 */

export type EnglishRequirement = 'not_stated' | 'basic' | 'intermediate' | 'advanced';

export type WorkMode = 'onsite' | 'hybrid' | 'remote' | 'unknown';

export interface SenioritySignal {
  readonly term: string;
  readonly level: 'junior' | 'senior';
  /** A signal in the title is a much stronger claim than one buried in the body. */
  readonly where: 'title' | 'description';
}

export interface JobRequirements {
  /** Years of experience demanded, or null when the posting never says. */
  readonly yearsRequired: number | null;
  readonly senioritySignals: readonly SenioritySignal[];
  readonly matchedStack: readonly string[];
  /** Which CV the winning stack lane points at. */
  readonly cvVariant: CvVariant;
  readonly englishRequired: EnglishRequirement;
  readonly workMode: WorkMode;
}

function signalsFor(
  level: 'junior' | 'senior',
  terms: readonly string[],
  normalizedTitle: string,
  normalizedBody: string,
): SenioritySignal[] {
  const inTitle = matchedTerms(normalizedTitle, terms);
  const inTitleSet = new Set(inTitle);
  const inBodyOnly = matchedTerms(normalizedBody, terms).filter(
    (term) => !inTitleSet.has(term),
  );

  return [
    ...inTitle.map((term) => ({ term, level, where: 'title' as const })),
    ...inBodyOnly.map((term) => ({ term, level, where: 'description' as const })),
  ];
}

function englishRequirementFor(
  normalizedText: string,
  config: ScoringConfig,
): EnglishRequirement {
  if (matchedTerms(normalizedText, config.language.highEnglishTerms).length > 0) {
    return 'advanced';
  }
  if (matchedTerms(normalizedText, config.language.mediumEnglishTerms).length > 0) {
    return 'intermediate';
  }
  if (matchedTerms(normalizedText, config.language.friendlyTerms).length > 0) {
    return 'basic';
  }
  // Deliberately NOT inferred from an English-written ad: "not stated" is a
  // fact, "probably needs English" would be a guess presented as a chip.
  return 'not_stated';
}

/**
 * Hybrid beats remote when both appear, because "hybrid with two remote days"
 * is a commute obligation and the candidate has to plan around it.
 */
function workModeFor(normalizedText: string, config: ScoringConfig): WorkMode {
  const { location } = config;

  if (matchedTerms(normalizedText, location.hybridTerms).length > 0) {
    return 'hybrid';
  }
  if (matchedTerms(normalizedText, location.remoteTerms).length > 0) {
    return 'remote';
  }

  const onSiteTerms = [
    ...location.primaryTerms,
    ...location.metroTerms,
    ...location.otherCityTerms,
  ];
  if (matchedTerms(normalizedText, onSiteTerms).length > 0) {
    return 'onsite';
  }

  return 'unknown';
}

export function extractRequirements(job: Job, config: ScoringConfig): JobRequirements {
  const normalizedTitle = normalizeText(job.title);
  const normalizedBody = normalizeText(`${job.company} ${job.location} ${job.description}`);
  const normalizedText = jobSearchText(job);

  const stack = scoreStack(normalizedText, config.stack);

  return {
    yearsRequired: extractRequiredYears(`${normalizedTitle} ${normalizedBody}`),
    senioritySignals: [
      ...signalsFor('junior', config.seniority.juniorTerms, normalizedTitle, normalizedBody),
      ...signalsFor('senior', config.seniority.seniorTerms, normalizedTitle, normalizedBody),
    ],
    // A lane keyword and a general keyword could overlap after a config edit;
    // the chips must not show the same technology twice.
    matchedStack: [...new Set(stack.matchedKeywords)],
    cvVariant: stack.cvVariant,
    englishRequired: englishRequirementFor(normalizedText, config),
    workMode: workModeFor(normalizedText, config),
  };
}
