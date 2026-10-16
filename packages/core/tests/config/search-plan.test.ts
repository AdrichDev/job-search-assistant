import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_PLAN } from '../../src/config/search-plan.js';

describe('DEFAULT_SEARCH_PLAN', () => {
  it('casts a wide net across both stack lanes', () => {
    const terms = DEFAULT_SEARCH_PLAN.map((query) => query.what).join(' ');
    expect(terms).toMatch(/react|javascript/i);
    expect(terms).toMatch(/power platform|business central/i);
    expect(terms).toMatch(/junior/i);
  });

  it('searches Madrid within a 30-day recency window', () => {
    expect(DEFAULT_SEARCH_PLAN.length).toBeGreaterThan(0);
    for (const query of DEFAULT_SEARCH_PLAN) {
      expect(query.where).toBe('Madrid');
      expect(query.maxDaysOld).toBeLessThanOrEqual(30);
    }
  });
});
