import type { JobSourceQuery } from '../ports/job-source.js';

/**
 * Adzuna's documented category tag for IT roles.
 *
 * Verified against Adzuna's own Swagger definition
 * (`GET https://api.adzuna.com/v1/api-docs/adzuna`), which declares a `category`
 * query parameter on `jobs/{country}/search/{page}` described as "The category
 * tag, as returned by the 'category' endpoint", and against the documented
 * categories response, which lists `{ label: "IT Jobs", tag: "it-jobs" }`.
 */
export const ADZUNA_IT_CATEGORY = 'it-jobs';

/**
 * WIDE INTAKE, NARROW DOMAIN.
 *
 * Two separate ideas, and conflating them is what produced a queue with
 * dentists in it:
 *
 * - Domain: every query is pinned to the IT category. A dental clinic or a call
 *   centre should never enter the pipeline in the first place. This is also the
 *   cheapest fix available - junk that is never fetched costs no API quota and
 *   no reasoning downstream.
 * - Stack: still deliberately broad. React, Microsoft and generic junior terms
 *   all stay, because the candidate's lanes are ranked, never filtered.
 *
 * The category filter is a first line of defence, not the defence. Adzuna's own
 * categorisation is imperfect, so the software-relevance gate still runs on
 * everything that comes back.
 */
export const DEFAULT_SEARCH_PLAN: readonly JobSourceQuery[] = [
  {
    what: 'junior developer',
    where: 'Madrid',
    category: ADZUNA_IT_CATEGORY,
    maxDaysOld: 30,
    resultsPerPage: 50,
    maxPages: 2,
  },
  {
    what: 'desarrollador junior',
    where: 'Madrid',
    category: ADZUNA_IT_CATEGORY,
    maxDaysOld: 30,
    resultsPerPage: 50,
    maxPages: 2,
  },
  {
    what: 'programador junior',
    where: 'Madrid',
    category: ADZUNA_IT_CATEGORY,
    maxDaysOld: 30,
    resultsPerPage: 50,
    maxPages: 1,
  },
  {
    what: 'react javascript',
    where: 'Madrid',
    category: ADZUNA_IT_CATEGORY,
    maxDaysOld: 30,
    resultsPerPage: 50,
    maxPages: 1,
  },
  {
    what: 'power platform',
    where: 'Madrid',
    category: ADZUNA_IT_CATEGORY,
    maxDaysOld: 30,
    resultsPerPage: 50,
    maxPages: 1,
  },
  {
    what: 'business central navision',
    where: 'Madrid',
    category: ADZUNA_IT_CATEGORY,
    maxDaysOld: 30,
    resultsPerPage: 50,
    maxPages: 1,
  },
  {
    what: 'becario desarrollo software',
    where: 'Madrid',
    category: ADZUNA_IT_CATEGORY,
    maxDaysOld: 30,
    resultsPerPage: 50,
    maxPages: 1,
  },
];
