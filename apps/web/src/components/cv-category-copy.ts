import type { CvCategorySuggestion } from '@job-queue/core/domain';
import { ES } from '@/copy/es';

/**
 * Pure view model for the "Categoría de CV sugerida" block.
 *
 * Kept out of the component so the wording for each reason is unit-tested
 * without rendering. It only ever receives the category suggestion, so it
 * cannot name a registered model or a file even by accident.
 */

export interface CvCategoryView {
  readonly heading: string;
  readonly categoryName: string;
  readonly explanation: string;
  readonly disclaimer: string;
}

/** "A", "A y B", "A, B y C". */
function joinSpanish(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1] ?? ''}`;
}

function explanationFor(suggestion: CvCategorySuggestion): string {
  switch (suggestion.reason) {
    case 'evidence':
      return ES.cvCategory.evidence(suggestion.matchedTerms.join(', '));
    case 'tie':
      return ES.cvCategory.tie(
        joinSpanish((suggestion.tiedCategories ?? []).map((name) => ES.cvCategory.names[name])),
      );
    case 'no_evidence':
      return ES.cvCategory.noEvidence;
  }
}

export function describeCvCategorySuggestion(suggestion: CvCategorySuggestion): CvCategoryView {
  return {
    heading: ES.cvCategory.heading,
    categoryName: ES.cvCategory.names[suggestion.category],
    explanation: explanationFor(suggestion),
    disclaimer: ES.cvCategory.disclaimer,
  };
}
