import { clamp01, matchedTerms } from '../text.js';
import type { SoftwareRelevanceConfig } from './types.js';

/**
 * DOMAIN RELEVANCE: is this a software job at all?
 *
 * This is a different axis from `stack.ts` and the two must never be collapsed:
 *
 * - `scoreStack` answers "which of the candidate's lanes is this closest to"
 *   (React vs Microsoft vs general). It is a PREFERENCE. It ranks, it never
 *   filters - wide intake is deliberate, and a backend job with no React in it
 *   still belongs in the queue.
 * - `scoreSoftwareRelevance` answers "is this software engineering work". It is
 *   a GATE. A dentist, a sales executive and a treasury clerk are not ranked
 *   lower, they are not in the list.
 *
 * The gate is multiplicative on purpose. The original defect was an additive
 * score: a dental clinic collected ~57/100 from being junior-friendly, in
 * Madrid, written in Spanish and posted today, while contributing nothing
 * technical. No weight tuning fixes that, it only moves the threshold. A factor
 * of zero fixes it permanently.
 *
 * The asymmetry below is deliberate. Missing a real junior software job is a
 * worse failure than letting one dentist through, so:
 *
 * - a role word in the TITLE is proof on its own, even with an empty body;
 * - non-software vocabulary in the BODY only ever subtracts a capped amount;
 * - non-software vocabulary in the TITLE contests the title instead, because
 *   "Sales Engineer" and "Frontend Engineer" cannot be told apart any other way.
 */

export interface SoftwareRelevanceResult {
  /** 0..1 confidence that this posting is software-engineering work. */
  readonly value: number;
  /** `value` measured against the configured gate threshold. */
  readonly isSoftware: boolean;
  readonly roleSignals: readonly string[];
  readonly technologySignals: readonly string[];
  /** Business tooling that corroborates but can never prove on its own. */
  readonly ambiguousSignals: readonly string[];
  readonly nonSoftwareSignals: readonly string[];
  /** Human-readable justification. This is what makes an exclusion arguable. */
  readonly reason: string;
}

export interface SoftwareRelevanceInput {
  readonly normalizedTitle: string;
  /** Title + company + location + description, already normalized. */
  readonly normalizedText: string;
}

function describe(
  evidence: string[],
  counterEvidence: readonly string[],
): string {
  const positive = evidence.length > 0 ? evidence.join('; ') : 'no software-engineering signal';
  if (counterEvidence.length === 0) {
    return positive;
  }
  return `${positive}; non-software domain: ${counterEvidence.join(', ')}`;
}

export function scoreSoftwareRelevance(
  input: SoftwareRelevanceInput,
  config: SoftwareRelevanceConfig,
): SoftwareRelevanceResult {
  const { normalizedTitle, normalizedText } = input;

  const titleRoleHits = matchedTerms(normalizedTitle, config.roleTerms);
  const allRoleHits = matchedTerms(normalizedText, config.roleTerms);
  const titleRoleSet = new Set(titleRoleHits);
  const bodyRoleHits = allRoleHits.filter((term) => !titleRoleSet.has(term));

  const technologyHits = matchedTerms(normalizedText, config.technologyTerms);
  const ambiguousHits = matchedTerms(normalizedText, config.ambiguousTechnologyTerms);

  const titleNonSoftwareHits = matchedTerms(normalizedTitle, config.nonSoftwareDomainTerms);
  const nonSoftwareHits = matchedTerms(normalizedText, config.nonSoftwareDomainTerms);

  // A contested title ("Sales Engineer", "Ingeniero Comercial") proves nothing.
  // The posting then has to earn its place from the body or the stack.
  const titleProof =
    titleRoleHits.length > 0 && titleNonSoftwareHits.length === 0 ? config.roleInTitleScore : 0;
  const bodyRoleProof = bodyRoleHits.length > 0 ? config.roleInBodyScore : 0;
  const technologyProof = clamp01(technologyHits.length / config.technologySaturation);

  const corroboration = Math.min(
    ambiguousHits.length * config.ambiguousTermBonus,
    config.ambiguousBonusCap,
  );

  const evidence = clamp01(
    Math.max(titleProof, bodyRoleProof, technologyProof) + corroboration,
  );
  const counterEvidence = Math.min(
    nonSoftwareHits.length * config.nonSoftwareTermPenalty,
    config.nonSoftwarePenaltyCap,
  );

  const value = clamp01(evidence - counterEvidence);

  const explanations: string[] = [];
  if (titleProof > 0) {
    explanations.push(`software role in title (${titleRoleHits.join(', ')})`);
  } else if (titleRoleHits.length > 0) {
    explanations.push(`title role word contested by its own domain (${titleRoleHits.join(', ')})`);
  }
  if (bodyRoleProof > 0) {
    explanations.push(`software role in description (${bodyRoleHits.join(', ')})`);
  }
  if (technologyHits.length > 0) {
    explanations.push(`engineering stack: ${technologyHits.join(', ')}`);
  }
  if (ambiguousHits.length > 0) {
    explanations.push(`ambiguous business tooling: ${ambiguousHits.join(', ')}`);
  }

  return {
    value,
    isSoftware: value >= config.gateThreshold,
    roleSignals: allRoleHits,
    technologySignals: technologyHits,
    ambiguousSignals: ambiguousHits,
    nonSoftwareSignals: nonSoftwareHits,
    reason: describe(explanations, nonSoftwareHits),
  };
}
