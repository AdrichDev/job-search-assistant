import type { JobSourceQuery } from '../ports/job-source.js';

/**
 * A broad search vocabulary shared by real search adapters.
 *
 * The plan names the candidate's role families but does not decide eligibility.
 * Location, required experience and seniority are enforced uniformly after
 * ingestion, so a provider cannot bypass product rules by ignoring a query.
 */
export const DEFAULT_SEARCH_PLAN: readonly JobSourceQuery[] = [
  { what: 'junior developer', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 2 },
  { what: 'desarrollador junior', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 2 },
  { what: 'programador junior', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 1 },
  { what: 'react javascript', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 1 },
  { what: 'power platform', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 1 },
  { what: 'business central navision', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 1 },
  { what: 'becario desarrollo software', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 1 },
];
