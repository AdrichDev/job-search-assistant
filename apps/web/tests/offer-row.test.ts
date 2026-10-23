import { describe, expect, it } from 'vitest';
import { formatPostedAge } from '@/lib/posted-age';
import { offerSnippet } from '@/lib/offer-snippet';

const POSTED = new Date('2026-03-10T09:00:00Z');

describe('formatPostedAge', () => {
  it('reads like a job board: minutes, hours, yesterday, days', () => {
    expect(formatPostedAge(POSTED, POSTED.getTime())).toBe('hace unos instantes');
    expect(formatPostedAge(POSTED, POSTED.getTime() + 5 * 60_000)).toBe('hace 5 minutos');
    expect(formatPostedAge(POSTED, POSTED.getTime() + 3 * 3_600_000)).toBe('hace 3 horas');
    expect(formatPostedAge(POSTED, POSTED.getTime() + 24 * 3_600_000)).toBe('ayer');
    expect(formatPostedAge(POSTED, POSTED.getTime() + 36 * 3_600_000)).toBe('ayer');
    expect(formatPostedAge(POSTED, POSTED.getTime() + 3 * 86_400_000)).toBe('hace 3 días');
    expect(formatPostedAge(POSTED, POSTED.getTime() + 6 * 86_400_000)).toBe('hace 6 días');
  });

  it('switches to the absolute date once the posting is a week old', () => {
    // The date shown is the posting's own date, 10 March in the fixture.
    expect(formatPostedAge(POSTED, POSTED.getTime() + 7 * 86_400_000 + 3_600_000)).toBe('10 mar 2026');
  });

  it('treats a clock skew as "just now" instead of a negative age', () => {
    expect(formatPostedAge(POSTED, POSTED.getTime() - 60_000)).toBe('hace unos instantes');
  });
});

describe('offerSnippet', () => {
  it('leaves a short description untouched and without ellipsis', () => {
    expect(offerSnippet('Equipo pequeño, sin experiencia previa.', 160)).toBe(
      'Equipo pequeño, sin experiencia previa.',
    );
  });

  it('cuts a long description at a word boundary and marks it with an ellipsis', () => {
    const snippet = offerSnippet(
      'Equipo pequeño que desarrolla en React. ' +
        'Buscan a alguien con ganas de aprender y muchas ganas de trabajar en producto. ' +
        'El resto del texto sobra.',
      80,
    );
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(81);
    expect(snippet.startsWith('Equipo pequeño')).toBe(true);
    // A word is never split in half.
    expect(snippet.endsWith(' ')).toBe(false);
  });

  it('never returns text for an empty description', () => {
    expect(offerSnippet('', 160)).toBe('');
  });
});
