import type { CvVariant, Job } from '../job.js';

export type ScoreDimension =
  | 'seniorityFit'
  | 'stackMatch'
  | 'locationFit'
  | 'languageFit'
  | 'recency';

export const SCORE_DIMENSIONS: readonly ScoreDimension[] = [
  'seniorityFit',
  'stackMatch',
  'locationFit',
  'languageFit',
  'recency',
];

/** Output of a single scoring dimension. `value` is always 0..1. */
export interface DimensionResult {
  readonly value: number;
  /** Human-readable justification. This is what makes the ranking trustable. */
  readonly reason: string;
}

export interface ScoreBreakdownItem extends DimensionResult {
  readonly dimension: ScoreDimension;
  readonly weight: number;
  /** Points this dimension contributed to the final 0..100 score. */
  readonly contribution: number;
}

/** Serializable summary of the domain-relevance gate for one posting. */
export interface SoftwareRelevanceSummary {
  /** 0..1 confidence that this is software-engineering work. */
  readonly value: number;
  readonly isSoftware: boolean;
  readonly reason: string;
}

export interface JobScore {
  /**
   * 0..100, rounded to one decimal. This is `totalBeforeGate` MULTIPLIED by the
   * software-relevance value, so a posting with no technical signal scores 0 no
   * matter how well it does on every other dimension.
   */
  readonly total: number;
  /** The purely additive weighted sum, before the relevance gate is applied. */
  readonly totalBeforeGate: number;
  readonly softwareRelevance: SoftwareRelevanceSummary;
  readonly cvVariant: CvVariant;
  readonly breakdown: readonly ScoreBreakdownItem[];
}

export interface ScoredJob {
  readonly job: Job;
  readonly score: JobScore;
}

/* ------------------------------------------------------------------ */
/* Config contract. The domain declares what it needs; src/config supplies it. */
/* ------------------------------------------------------------------ */

export type ScoringWeights = Readonly<Record<ScoreDimension, number>>;

export interface SeniorityConfig {
  /** Score every job starts from before signals are applied. */
  readonly baseline: number;
  readonly juniorTerms: readonly string[];
  readonly seniorTerms: readonly string[];
  readonly juniorTermBoost: number;
  readonly seniorTermPenalty: number;
  /** Required years at or below this count read as junior-friendly. */
  readonly juniorYearsThreshold: number;
  /** Required years at or above this count are treated as a hard mismatch. */
  readonly seniorYearsThreshold: number;
  readonly juniorYearsBoost: number;
  readonly midYearsPenalty: number;
  readonly seniorYearsPenalty: number;
}

export interface StackLaneConfig {
  readonly id: Exclude<CvVariant, 'general'>;
  readonly label: string;
  readonly keywords: readonly string[];
}

/**
 * DOMAIN RELEVANCE vocabulary - deliberately separate from `StackConfig`.
 *
 * `StackConfig` decides WHICH software lane a posting belongs to (a preference,
 * used for ranking and CV selection). This decides WHETHER it is software work
 * at all (a gate, used for exclusion). Never merge the two lists: a keyword can
 * be excellent at picking a CV variant and useless at proving the posting is
 * engineering work - `erp` was exactly that.
 */
export interface SoftwareRelevanceConfig {
  /** Job-title shapes only software engineering uses. A title hit is proof. */
  readonly roleTerms: readonly string[];
  /** Technologies that effectively only appear in engineering postings. */
  readonly technologyTerms: readonly string[];
  /**
   * Business tooling (ERP, CRM, Excel, Jira, SQL...) that finance, HR, PMO and
   * ops postings list just as often as engineering ones. Corroborates only.
   */
  readonly ambiguousTechnologyTerms: readonly string[];
  /** Vocabulary that identifies a clearly non-software profession. */
  readonly nonSoftwareDomainTerms: readonly string[];
  readonly roleInTitleScore: number;
  readonly roleInBodyScore: number;
  /** Unambiguous technology hits needed to prove relevance without a role word. */
  readonly technologySaturation: number;
  readonly ambiguousTermBonus: number;
  readonly ambiguousBonusCap: number;
  readonly nonSoftwareTermPenalty: number;
  /** Ceiling on the penalty, so prose about "the sales team" cannot delete a real job. */
  readonly nonSoftwarePenaltyCap: number;
  /** Relevance below this leaves the queue entirely, into the reported excluded set. */
  readonly gateThreshold: number;
}

export interface StackConfig {
  /** Evaluated in order; ties are broken by this order. */
  readonly lanes: readonly StackLaneConfig[];
  readonly generalKeywords: readonly string[];
  /** Lane keyword hits needed to max out the lane component. */
  readonly laneSaturation: number;
  readonly generalSaturation: number;
  /** laneShare + generalShare must equal 1. */
  readonly laneShare: number;
  readonly generalShare: number;
  /** Ceiling applied when no lane keyword matched at all (the `general` variant). */
  readonly generalOnlyShare: number;
}

export interface LocationConfig {
  readonly primaryTerms: readonly string[];
  readonly metroTerms: readonly string[];
  readonly remoteTerms: readonly string[];
  readonly hybridTerms: readonly string[];
  readonly countryTerms: readonly string[];
  readonly otherCityTerms: readonly string[];
  readonly scores: {
    readonly primary: number;
    readonly metro: number;
    readonly remoteSpain: number;
    readonly remoteUnspecified: number;
    readonly remoteGlobalEnglish: number;
    readonly otherSpanishCity: number;
    readonly unknown: number;
  };
}

export interface LanguageConfig {
  /** C1/C2/fluent/native demands. B1 cannot clear these. */
  readonly highEnglishTerms: readonly string[];
  readonly mediumEnglishTerms: readonly string[];
  readonly friendlyTerms: readonly string[];
  readonly spanishStopwords: readonly string[];
  readonly englishStopwords: readonly string[];
  /** English stopword hits required (with zero Spanish hits) to call a posting English-only. */
  readonly englishOnlyMinHits: number;
  readonly scores: {
    readonly high: number;
    readonly medium: number;
    readonly englishOnly: number;
    readonly neutral: number;
    readonly friendly: number;
  };
}

export interface RecencyConfig {
  /** Days after which a posting scores `floor`. */
  readonly decayDays: number;
  readonly floor: number;
}

export interface ScoringConfig {
  readonly weights: ScoringWeights;
  readonly seniority: SeniorityConfig;
  /** Stack PREFERENCE: ranks and picks the CV variant. Never filters. */
  readonly stack: StackConfig;
  /** Domain RELEVANCE: gates the final score and drives exclusion. */
  readonly softwareRelevance: SoftwareRelevanceConfig;
  readonly location: LocationConfig;
  readonly language: LanguageConfig;
  readonly recency: RecencyConfig;
}
