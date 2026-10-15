import { describe, expect, it } from 'vitest';
import {
  BOARD_PROVIDER_IDS,
  COMPANY_BOARDS,
  DEFAULT_BOARD_LOCATION_FILTER,
  companiesFor,
} from '../../src/config/company-boards.js';

/**
 * Coverage for these three sources is not a property of the code, it is a
 * property of THIS LIST. That makes the list first-class configuration, and
 * these tests are what stop it rotting into a pile of plausible-looking slugs
 * nobody ever checked.
 */
describe('COMPANY_BOARDS', () => {
  it('is not empty', () => {
    expect(COMPANY_BOARDS.length).toBeGreaterThan(0);
  });

  it('covers all three providers', () => {
    for (const provider of BOARD_PROVIDER_IDS) {
      expect(companiesFor(provider).length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate provider+slug pair', () => {
    const keys = COMPANY_BOARDS.map((entry) => `${entry.provider}:${entry.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses slugs that are safe to put in a URL path unescaped', () => {
    for (const entry of COMPANY_BOARDS) {
      expect(entry.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(encodeURIComponent(entry.slug)).toBe(entry.slug);
    }
  });

  it('records when each slug was verified against the live API', () => {
    // A fabricated slug list is worse than a short honest one, so every entry
    // carries the date its HTTP 200 was actually observed.
    for (const entry of COMPANY_BOARDS) {
      expect(entry.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.verifiedOn))).toBe(false);
    }
  });

  it('records how many Spanish openings each board had when it was verified', () => {
    for (const entry of COMPANY_BOARDS) {
      expect(entry.spainOpeningsAtVerification).toBeGreaterThan(0);
    }
  });

  it('records how many of those Spanish openings were software work', () => {
    // BAR 3. Separate from the count above because they fail separately: Sixt
    // had 35 Spanish openings and not one of them was a software job, and
    // `build-job-queue.ts` would have discarded every single one. Requiring the
    // number here is what stops a slug being added on "it returned 200" alone.
    for (const entry of COMPANY_BOARDS) {
      expect(entry.softwareOpeningsAtVerification).toBeGreaterThan(0);
    }
  });

  it('never claims more software openings than Spanish openings', () => {
    // The software count is a SUBSET of the Spanish count. A transposed pair
    // would otherwise sit here looking perfectly plausible.
    for (const entry of COMPANY_BOARDS) {
      expect(entry.softwareOpeningsAtVerification).toBeLessThanOrEqual(
        entry.spainOpeningsAtVerification,
      );
    }
  });

  it('records both counts as whole numbers of postings', () => {
    for (const entry of COMPANY_BOARDS) {
      expect(Number.isInteger(entry.spainOpeningsAtVerification)).toBe(true);
      expect(Number.isInteger(entry.softwareOpeningsAtVerification)).toBe(true);
    }
  });

  it('gives every board a human display name', () => {
    for (const entry of COMPANY_BOARDS) {
      expect(entry.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  it('filters by provider without leaking other providers', () => {
    for (const provider of BOARD_PROVIDER_IDS) {
      expect(companiesFor(provider).every((entry) => entry.provider === provider)).toBe(true);
    }
  });

  it('returns an empty list for an unknown provider rather than throwing', () => {
    // Defensive: the CLI maps user input onto this.
    expect(companiesFor('nope' as never)).toEqual([]);
  });
});

describe('DEFAULT_BOARD_LOCATION_FILTER', () => {
  it('covers Madrid first and Spain as the wider net', () => {
    expect(DEFAULT_BOARD_LOCATION_FILTER.cityTerms).toContain('madrid');
    expect(DEFAULT_BOARD_LOCATION_FILTER.countryTerms).toContain('spain');
    expect(DEFAULT_BOARD_LOCATION_FILTER.countryTerms).toContain('espana');
  });

  it('holds only normalized lowercase terms, since that is what it is matched against', () => {
    const all = [
      ...DEFAULT_BOARD_LOCATION_FILTER.cityTerms,
      ...DEFAULT_BOARD_LOCATION_FILTER.countryTerms,
    ];
    for (const term of all) {
      expect(term).toBe(term.toLowerCase());
      expect(term.trim()).toBe(term);
      expect(term.length).toBeGreaterThan(0);
    }
  });
});
