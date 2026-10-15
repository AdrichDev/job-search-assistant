import { describe, expect, it } from 'vitest';
import { ADZUNA_IT_CATEGORY, DEFAULT_SEARCH_PLAN } from '../../src/config/search-plan.js';

/**
 * Upstream narrowing. Every point of junk that never enters the pipeline is a
 * point the gate does not have to argue about, and API quota that is not spent.
 *
 * `it-jobs` is the category tag Adzuna documents for IT roles; `category` is the
 * documented search parameter that consumes it.
 */
describe('DEFAULT_SEARCH_PLAN', () => {
  it('constrains every query to the IT category', () => {
    expect(DEFAULT_SEARCH_PLAN.length).toBeGreaterThan(0);
    for (const query of DEFAULT_SEARCH_PLAN) {
      expect(query.category).toBe(ADZUNA_IT_CATEGORY);
    }
  });

  it('uses the documented Adzuna category tag', () => {
    expect(ADZUNA_IT_CATEGORY).toBe('it-jobs');
  });

  it('still casts a wide net across both stack lanes', () => {
    const terms = DEFAULT_SEARCH_PLAN.map((query) => query.what).join(' ');
    expect(terms).toMatch(/react|javascript/i);
    expect(terms).toMatch(/power platform|business central/i);
    expect(terms).toMatch(/junior/i);
  });

  it('keeps searching Madrid within the recency window the scorer assumes', () => {
    for (const query of DEFAULT_SEARCH_PLAN) {
      expect(query.where).toBe('Madrid');
      expect(query.maxDaysOld).toBeLessThanOrEqual(30);
    }
  });
});
