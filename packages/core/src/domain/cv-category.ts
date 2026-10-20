import { containsTerm, normalizeText } from './text.js';

/**
 * Which KIND of CV an offer points at. A recommendation, never a selection.
 *
 * Until the final CV PDFs exist there is no concrete model to point at, so this
 * module answers only "which of the approved categories does the offer's own
 * wording support, and on what evidence?". It reads NOTHING but the offer's
 * title and description: not the company, not the location, not the candidate
 * profile and not the model registry. That is why its output can never carry a
 * model id, a file path or a registered name - it has no way to learn one.
 *
 * Pure: no I/O, no node builtins, safe for a client bundle.
 */

export const CV_CATEGORIES = [
  'java_spring_backend',
  'full_stack',
  'python_data_ai',
  'frontend',
  'qa_testing',
  'microsoft_power_platform',
  'general',
] as const;

export type CvCategory = (typeof CV_CATEGORIES)[number];

/** A category that can win on evidence (everything except the fallback). */
type EvidenceCategory = Exclude<CvCategory, 'general'>;

/**
 * - `evidence`: one category has the strictly highest score.
 * - `no_evidence`: no vocabulary term matched at all.
 * - `tie`: two or more categories share the top score; General is returned.
 */
export type CvCategoryReason = 'evidence' | 'no_evidence' | 'tie';

export interface CvCategorySuggestion {
  readonly category: CvCategory;
  /** The winner's matched vocabulary terms. Empty for General. */
  readonly matchedTerms: readonly string[];
  readonly reason: CvCategoryReason;
  /** Present ONLY when `reason` is `tie`, in deterministic category order. */
  readonly tiedCategories?: readonly CvCategory[];
}

/** The only fields this function reads. Deliberately no company or location. */
export interface CvCategoryInput {
  readonly title: string;
  readonly description: string;
}

/**
 * Conservative vocabulary. A term is here only if it is specific enough to
 * speak for the category on its own.
 *
 * Deliberately ABSENT (too ambiguous alone): test, testing, pruebas, power, ai,
 * ia, data, datos, ui, api, rest, sql, azure, backend, junit, jest.
 *
 * Declaration order doubles as the deterministic tie order.
 */
const VOCABULARY: Readonly<Record<EvidenceCategory, readonly string[]>> = {
  java_spring_backend: [
    'java',
    'spring',
    'spring boot',
    'springboot',
    'hibernate',
    'jpa',
    'maven',
    'j2ee',
    'jakarta ee',
  ],
  // Never scored by ordinary terms: only the explicit markers below count.
  full_stack: [],
  python_data_ai: [
    'python',
    'pandas',
    'numpy',
    'pyspark',
    'scikit-learn',
    'tensorflow',
    'pytorch',
    'machine learning',
    'deep learning',
    'data science',
    'data scientist',
    'data engineer',
    'etl',
    'nlp',
    'llm',
    'artificial intelligence',
    'inteligencia artificial',
  ],
  frontend: [
    'react',
    'angular',
    'vue',
    'vue.js',
    'next.js',
    'svelte',
    'typescript',
    'javascript',
    'html',
    'css',
    'tailwind',
    'redux',
    'frontend',
    'front-end',
    'front end',
  ],
  qa_testing: [
    'qa',
    'quality assurance',
    'tester',
    'test engineer',
    'test automation',
    'manual testing',
    'automatizacion de pruebas',
    'pruebas automatizadas',
    'pruebas funcionales',
    'selenium',
    'cypress',
    'playwright',
    'jmeter',
    'cucumber',
    'istqb',
  ],
  microsoft_power_platform: [
    'power apps',
    'powerapps',
    'power platform',
    'power automate',
    'power bi',
    'power pages',
    'dataverse',
    'dynamics 365',
    'business central',
    'navision',
    'sharepoint',
    '.net',
    'asp.net',
    'dotnet',
    'c#',
    'microsoft 365',
  ],
};

/**
 * An explicit marker states the ROLE itself, so it outranks any count of
 * ordinary stack terms. Without one, Full stack is never inferred from
 * combining frontend and backend evidence.
 */
const FULL_STACK_MARKERS: readonly string[] = ['full stack', 'full-stack', 'fullstack'];

/** Tie order, fixed so the same offer always lists the same categories. */
const EVIDENCE_ORDER: readonly EvidenceCategory[] = [
  'java_spring_backend',
  'full_stack',
  'python_data_ai',
  'frontend',
  'qa_testing',
  'microsoft_power_platform',
];

const NO_EVIDENCE: CvCategorySuggestion = {
  category: 'general',
  matchedTerms: [],
  reason: 'no_evidence',
};

/**
 * Terms of ONE category found in the haystack, one per textual signal.
 *
 * `Spring Boot` matches both `spring boot` and `spring`, `ASP.NET` both
 * `asp.net` and `.net`, `Vue.js` both `vue.js` and `vue`: the same words, scored
 * twice. After token-boundary matching, a matched term that is a strict
 * substring of a longer matched term of the same category is dropped and the
 * more specific one kept. Vocabulary order is preserved for the rest. This is
 * applied per category only, so it never changes a cross-category comparison.
 */
function distinctMatches(haystack: string, terms: readonly string[]): string[] {
  const matched = [...new Set(terms)].filter((term) => containsTerm(haystack, term));
  const normalized = matched.map((term) => normalizeText(term));

  return matched.filter(
    (_term, index) =>
      !normalized.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.length > (normalized[index] ?? '').length &&
          other.includes(normalized[index] ?? ''),
      ),
  );
}

export function suggestCvCategory(input: CvCategoryInput): CvCategorySuggestion {
  const haystack = normalizeText(`${input.title} ${input.description}`);

  const markers = distinctMatches(haystack, FULL_STACK_MARKERS);
  if (markers.length > 0) {
    return { category: 'full_stack', matchedTerms: markers, reason: 'evidence' };
  }

  const matches = new Map<EvidenceCategory, readonly string[]>();
  let top = 0;
  for (const category of EVIDENCE_ORDER) {
    const terms = distinctMatches(haystack, VOCABULARY[category]);
    matches.set(category, terms);
    top = Math.max(top, terms.length);
  }

  if (top === 0) {
    return { ...NO_EVIDENCE };
  }

  const leaders = EVIDENCE_ORDER.filter((category) => (matches.get(category)?.length ?? 0) === top);
  const [winner] = leaders;
  if (leaders.length === 1 && winner !== undefined) {
    return { category: winner, matchedTerms: matches.get(winner) ?? [], reason: 'evidence' };
  }

  return {
    category: 'general',
    matchedTerms: [],
    reason: 'tie',
    tiedCategories: leaders,
  };
}
