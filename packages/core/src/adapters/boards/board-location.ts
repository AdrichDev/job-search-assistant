import { containsTerm, normalizeText } from '../../domain/text.js';

/**
 * Location narrowing for per-company boards.
 *
 * Adzuna is a SEARCH ENGINE: it takes `where` and answers with Madrid. A
 * company board is not - it hands back the entire board, all 618 Stripe
 * postings worldwide included. Somebody has to drop Lima and San Francisco, and
 * that somebody is here.
 *
 * This is emphatically NOT the stack filtering the `JobSource` port forbids. It
 * narrows WHERE, never WHAT: an accounting role in Madrid still comes through
 * and still gets judged by the software-relevance gate downstream, exactly like
 * an Adzuna posting does.
 *
 * Deliberately generous inside Spain: a Barcelona posting is kept and then
 * ranked down by the location dimension, rather than deleted here where the
 * candidate could never see or argue with the decision.
 */
export interface BoardLocationFilter {
  /** City-level terms, e.g. `madrid`. Already normalized. */
  readonly cityTerms: readonly string[];
  /** Country-level terms, e.g. `spain`, `espana`, `es`. Already normalized. */
  readonly countryTerms: readonly string[];
}

/**
 * True when ANY of the location strings a board attached mentions the target
 * country or city.
 *
 * Several strings rather than one because Ashby splits `location` from
 * `secondaryLocations`, and a pan-European remote role routinely carries Spain
 * only in the second list. Checking `location` alone silently drops exactly the
 * remote roles this candidate is most likely to land.
 *
 * Matching goes through `containsTerm`, so `es` cannot fire inside `Leeds` and
 * `spain` cannot fire inside a longer word.
 */
export function matchesBoardLocation(
  locations: readonly string[],
  filter: BoardLocationFilter,
): boolean {
  const terms = [...filter.cityTerms, ...filter.countryTerms];

  for (const location of locations) {
    const normalized = normalizeText(location);
    if (normalized.length === 0) {
      continue;
    }
    if (terms.some((term) => containsTerm(normalized, term))) {
      return true;
    }
  }

  return false;
}

/**
 * Widens a filter with the city the search plan actually asked for.
 *
 * Keeps the country terms, because dropping them would turn `where: 'Zaragoza'`
 * into a filter that rejects every "Spain (Remote)" posting on every board.
 * A blank term is ignored rather than added, since an empty needle would match
 * nothing useful and only invites confusion.
 */
export function withExtraCityTerms(
  filter: BoardLocationFilter,
  ...extra: readonly string[]
): BoardLocationFilter {
  const additions = extra
    .map((term) => normalizeText(term))
    .filter((term) => term.length > 0 && !filter.cityTerms.includes(term));

  if (additions.length === 0) {
    return filter;
  }

  return {
    cityTerms: [...filter.cityTerms, ...additions],
    countryTerms: filter.countryTerms,
  };
}
