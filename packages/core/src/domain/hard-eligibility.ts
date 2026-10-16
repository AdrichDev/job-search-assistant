import { type Job } from './job.js';
import type { JuniorFilterConfig } from './junior-eligibility.js';
import type { LocationConfig } from './scoring/types.js';
import { extractRequiredYears } from './scoring/seniority.js';
import { matchedTerms, normalizeText } from './text.js';

/**
 * THE UNIFIED HARD ELIGIBILITY FILTER (locality, experience, seniority).
 *
 * One rule set, applied after ingestion to every source identically. Same
 * asymmetry as `junior-eligibility.ts`: a posting is removed ONLY on an
 * explicit incompatible signal, and silence is inclusion.
 *
 *   - Locality: keep Madrid/nearby, hybrid in Madrid, remote performable from
 *     Spain. Exclude explicit other cities/countries. UNKNOWN LOCATION IS KEPT.
 *   - Experience: exclude an explicit requirement of `maxYearsRequired` (3) or
 *     more years, i.e. anything above 2. Unstated years are kept.
 *   - Seniority: exclude senior/lead/manager-type TITLES, except a management
 *     title that also carries a junior-level word. No explicit level is kept.
 *
 * Each exclusion carries a stable machine code so the audit trail can be
 * counted, filtered and compared across runs.
 */

export type HardExclusionCode =
  | 'location_incompatible'
  | 'experience_over_limit'
  | 'seniority_excluded';

export interface HardEligibilityVerdict {
  readonly eligible: boolean;
  /** Null when eligible. When several rules fail: location, then seniority, then experience. */
  readonly code: HardExclusionCode | null;
  /** Always populated. */
  readonly reason: string;
}

interface Violation {
  readonly code: HardExclusionCode;
  readonly reason: string;
}

function formatYears(years: number): string {
  const amount = Number.isInteger(years) ? `${years}` : years.toFixed(1);
  return `${amount} year${years === 1 ? '' : 's'}`;
}

function judgeLocation(
  job: Job,
  config: JuniorFilterConfig,
  location: LocationConfig,
): Violation | null {
  const field = normalizeText(job.location);

  const madridInField = [
    ...matchedTerms(field, location.primaryTerms),
    ...matchedTerms(field, location.metroTerms),
  ];
  if (madridInField.length > 0) {
    return null;
  }

  const remote = matchedTerms(field, location.remoteTerms).length > 0;
  const hybrid = matchedTerms(field, location.hybridTerms).length > 0;
  const spain = matchedTerms(field, location.countryTerms).length > 0;
  const worldwide = matchedTerms(field, config.worldwideLocationTerms ?? []).length > 0;
  const otherCity = matchedTerms(field, location.otherCityTerms);
  const foreign = matchedTerms(field, config.foreignLocationTerms ?? []);

  // The field says nothing recognizable: fall back to the body, then to
  // "unknown", which is KEPT. Missing data is not evidence of incompatibility.
  if (!remote && !hybrid && !spain && !worldwide && otherCity.length === 0 && foreign.length === 0) {
    return null;
  }

  if (foreign.length > 0 && !spain && !worldwide) {
    return {
      code: 'location_incompatible',
      reason: `location is outside Spain (${foreign[0]}), so it is neither Madrid nor remote from Spain`,
    };
  }

  if (remote) {
    // Remote in Spain, Europe/worldwide, or with the country unstated.
    return null;
  }

  if (otherCity.length > 0) {
    return {
      code: 'location_incompatible',
      reason: hybrid
        ? `hybrid outside Madrid (${otherCity[0]})`
        : `on-site outside Madrid (${otherCity[0]})`,
    };
  }

  // Hybrid or on-site with no stated place at all: unknown, KEPT.
  return null;
}

function judgeSeniority(job: Job, config: JuniorFilterConfig): Violation | null {
  const title = normalizeText(job.title);

  const ranks = matchedTerms(title, config.disqualifyingTitleTerms);
  if (ranks.length > 0) {
    return {
      code: 'seniority_excluded',
      reason: `title states a rank a first-job candidate cannot hold (${ranks.join(', ')})`,
    };
  }

  const managers = matchedTerms(title, config.managerTitleTerms ?? []);
  if (managers.length > 0) {
    const exempt = matchedTerms(title, config.managerExemptTitleTerms ?? []);
    if (exempt.length === 0) {
      return {
        code: 'seniority_excluded',
        reason: `title is a management role with no junior/entry-level qualifier (${managers.join(', ')})`,
      };
    }
  }

  return null;
}

function judgeExperience(job: Job, config: JuniorFilterConfig): Violation | null {
  // Same parser the UI chip uses, so filter and chip cannot disagree.
  const years = extractRequiredYears(
    normalizeText(`${job.title} ${job.company} ${job.location} ${job.description}`),
  );

  if (years !== null && years >= config.maxYearsRequired) {
    return {
      code: 'experience_over_limit',
      reason: `asks for ${formatYears(years)} of experience (limit is ${config.maxYearsRequired - 1})`,
    };
  }
  return null;
}

export function judgeHardEligibility(
  job: Job,
  config: JuniorFilterConfig,
  location: LocationConfig,
): HardEligibilityVerdict {
  const violation =
    judgeLocation(job, config, location) ??
    judgeSeniority(job, config) ??
    judgeExperience(job, config);

  if (violation !== null) {
    return { eligible: false, code: violation.code, reason: violation.reason };
  }
  return {
    eligible: true,
    code: null,
    reason: 'no explicit incompatible location, experience or seniority signal',
  };
}
