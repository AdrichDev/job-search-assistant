import { describe, expect, it } from 'vitest';
import {
  matchesBoardLocation,
  withExtraCityTerms,
} from '../../../src/adapters/boards/board-location.js';
import { DEFAULT_BOARD_LOCATION_FILTER } from '../../../src/config/company-boards.js';

/**
 * Company boards are not search engines: they hand back the ENTIRE board, so
 * the location narrowing that Adzuna does server-side has to happen here.
 *
 * This is a location filter, never a stack filter - the port contract still
 * forbids an adapter from deciding which technologies deserve to compete.
 */
const filter = DEFAULT_BOARD_LOCATION_FILTER;

describe('matchesBoardLocation', () => {
  it('accepts the primary city', () => {
    expect(matchesBoardLocation(['Madrid'], filter)).toBe(true);
  });

  it('accepts real strings observed on the live boards', () => {
    // Greenhouse (cabify, gitlab, typeform, grafanalabs, datadog)
    expect(matchesBoardLocation(['Madrid, Spain'], filter)).toBe(true);
    expect(matchesBoardLocation(['Remote, Spain'], filter)).toBe(true);
    expect(matchesBoardLocation(['Spain (Remote)'], filter)).toBe(true);
    expect(matchesBoardLocation(['Remote - Spain'], filter)).toBe(true);
    expect(
      matchesBoardLocation(['Remote Ireland; Remote, Spain; Remote, United Kingdom'], filter),
    ).toBe(true);
    // Lever (jobandtalent) uses the ISO code
    expect(matchesBoardLocation(['Madrid HQ, ES'], filter)).toBe(true);
    expect(matchesBoardLocation(['Valencia, ES'], filter)).toBe(true);
    // Ashby (legora, n8n) splits primary and secondary locations
    expect(matchesBoardLocation(['Berlin Office', 'Spain', 'Norway'], filter)).toBe(true);
  });

  it('rejects locations with no Spanish presence at all', () => {
    expect(matchesBoardLocation(['Lima'], filter)).toBe(false);
    expect(matchesBoardLocation(['Bogota, CO'], filter)).toBe(false);
    expect(matchesBoardLocation(['Berlin Office'], filter)).toBe(false);
    expect(matchesBoardLocation(['San Francisco, CA'], filter)).toBe(false);
    expect(matchesBoardLocation(['Remote - United States'], filter)).toBe(false);
  });

  it('respects token boundaries instead of matching substrings', () => {
    // "es" is Spain's ISO code, but it must not fire inside another word.
    expect(matchesBoardLocation(['Leeds, UK'], filter)).toBe(false);
    expect(matchesBoardLocation(['Tbilisi'], filter)).toBe(false);
  });

  it('ignores accents and casing', () => {
    expect(matchesBoardLocation(['ESPAÑA'], filter)).toBe(true);
    expect(matchesBoardLocation(['españa'], filter)).toBe(true);
  });

  it('treats an empty location list as unmatched rather than throwing', () => {
    expect(matchesBoardLocation([], filter)).toBe(false);
    expect(matchesBoardLocation([''], filter)).toBe(false);
  });

  it('lets the search plan add its own city without losing the country terms', () => {
    const extended = withExtraCityTerms(filter, 'Zaragoza');
    expect(matchesBoardLocation(['Zaragoza'], extended)).toBe(true);
    expect(matchesBoardLocation(['Madrid'], extended)).toBe(true);
    expect(matchesBoardLocation(['Lima'], extended)).toBe(false);
  });

  it('ignores a blank extra term instead of matching everything', () => {
    const extended = withExtraCityTerms(filter, '   ');
    expect(matchesBoardLocation(['Lima'], extended)).toBe(false);
  });
});
