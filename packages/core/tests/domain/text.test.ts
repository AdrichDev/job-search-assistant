import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  clamp01,
  containsTerm,
  locationKey,
  matchedTerms,
  normalizeText,
} from '../../src/domain/text.js';

describe('normalizeText', () => {
  it('lowercases, strips accents and collapses whitespace', () => {
    expect(normalizeText('  Programación   JÚNIOR  ')).toBe('programacion junior');
  });

  it('preserves the punctuation used by stack keywords', () => {
    expect(normalizeText('C#, .NET and Next.js — 3+ years')).toBe('c# .net and next.js 3+ years');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeText('   \n\t ')).toBe('');
  });
});

describe('containsTerm', () => {
  it('matches a whole word', () => {
    expect(containsTerm(normalizeText('Junior Developer'), 'junior')).toBe(true);
  });

  it('does not match java inside javascript', () => {
    expect(containsTerm(normalizeText('We use JavaScript daily'), 'java')).toBe(false);
  });

  it('does not match sql inside mysql', () => {
    expect(containsTerm(normalizeText('MySQL administration'), 'sql')).toBe(false);
  });

  it('matches keywords containing # and .', () => {
    const haystack = normalizeText('Desarrollo en C# y .NET Core');
    expect(containsTerm(haystack, 'c#')).toBe(true);
    expect(containsTerm(haystack, '.net')).toBe(true);
  });

  it('matches a term followed by punctuation', () => {
    expect(containsTerm(normalizeText('Stack: React, Redux'), 'react')).toBe(true);
  });

  it('matches multi-word terms', () => {
    expect(containsTerm(normalizeText('Experto en Power Apps'), 'power apps')).toBe(true);
  });

  it('returns false for an empty term', () => {
    expect(containsTerm('anything', '')).toBe(false);
  });

  /**
   * Short keywords must never fire inside a longer, unrelated word. `erp` used
   * to be a Microsoft-lane keyword and "Treasury Administrator" landed in that
   * lane, so these are the exact shapes that theory predicted.
   */
  it('does not match erp inside interpersonal or enterprise', () => {
    expect(containsTerm(normalizeText('Strong interpersonal skills'), 'erp')).toBe(false);
    expect(containsTerm(normalizeText('Enterprise architecture'), 'erp')).toBe(false);
  });

  it('does not match ui inside a longer Spanish word', () => {
    expect(containsTerm(normalizeText('Buen manejo de la interfaz de usuario'), 'ui')).toBe(false);
    expect(containsTerm(normalizeText('Quiere aprender'), 'ui')).toBe(false);
  });

  /**
   * The mirror-image bug: a keyword that STARTS with punctuation was unmatchable
   * whenever the ad glued it to the previous word. `.net` never matched
   * "ASP.NET", which is how most postings spell it.
   */
  it('matches a punctuation-led keyword glued to the previous word', () => {
    expect(containsTerm(normalizeText('ASP.NET Core developer'), '.net')).toBe(true);
    expect(containsTerm(normalizeText('Experiencia en ASP.NET MVC'), '.net')).toBe(true);
  });

  it('still refuses a punctuation-led keyword that runs into a longer word', () => {
    expect(containsTerm(normalizeText('asp.network engineer'), '.net')).toBe(false);
  });

  it('keeps matching a keyword hyphenated to another token', () => {
    expect(containsTerm(normalizeText('react-native experience'), 'react')).toBe(true);
    expect(containsTerm(normalizeText('node-js background'), 'node')).toBe(true);
  });
});

describe('matchedTerms', () => {
  it('returns only the present terms, in config order', () => {
    const haystack = normalizeText('React and TypeScript with Tailwind');
    expect(matchedTerms(haystack, ['react', 'vue', 'typescript'])).toEqual(['react', 'typescript']);
  });
});

describe('clamp01', () => {
  it('clamps below zero and above one', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(4)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });

  it('treats NaN as zero', () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('locationKey', () => {
  it('collapses verbose and short spellings of the same place', () => {
    expect(locationKey('Madrid, Comunidad de Madrid, Spain')).toBe(locationKey('Madrid'));
  });

  it('falls back to a sentinel for empty locations', () => {
    expect(locationKey('')).toBe('unknown');
  });

  it('keeps different cities apart', () => {
    expect(locationKey('Barcelona')).not.toBe(locationKey('Madrid'));
  });
});

describe('ageInDays', () => {
  it('measures elapsed days', () => {
    const now = new Date('2026-09-07T00:00:00Z');
    const posted = new Date('2026-09-02T00:00:00Z');
    expect(ageInDays(posted, now)).toBe(5);
  });

  it('floors future postings at zero', () => {
    const now = new Date('2026-09-07T00:00:00Z');
    const posted = new Date('2026-09-20T00:00:00Z');
    expect(ageInDays(posted, now)).toBe(0);
  });
});
