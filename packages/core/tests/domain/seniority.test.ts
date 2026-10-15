import { describe, expect, it } from 'vitest';
import { extractRequiredYears, scoreSeniority } from '../../src/domain/scoring/seniority.js';
import { normalizeText } from '../../src/domain/text.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';

const config = DEFAULT_SCORING_CONFIG.seniority;

function score(title: string, body: string): number {
  return scoreSeniority(
    { normalizedTitle: normalizeText(title), normalizedBody: normalizeText(body) },
    config,
  ).value;
}

describe('extractRequiredYears', () => {
  it('reads years stated before the experience noun', () => {
    expect(extractRequiredYears(normalizeText('Se requieren 3 años de experiencia'))).toBe(3);
  });

  it('reads years stated after the experience noun', () => {
    expect(extractRequiredYears(normalizeText('Experiencia mínima de 5 años'))).toBe(5);
  });

  it('reads the English phrasing', () => {
    expect(extractRequiredYears(normalizeText('3+ years of experience required'))).toBe(3);
  });

  it('takes the upper bound of a range', () => {
    expect(extractRequiredYears(normalizeText('Entre 3 y 5 años de experiencia'))).toBe(5);
  });

  it('reads 0-1 años as one year', () => {
    expect(extractRequiredYears(normalizeText('0-1 años de experiencia'))).toBe(1);
  });

  it('converts a months requirement into fractional years', () => {
    expect(extractRequiredYears(normalizeText('6 meses de experiencia'))).toBeCloseTo(0.5, 5);
  });

  it('ignores year mentions unrelated to experience', () => {
    expect(extractRequiredYears(normalizeText('Ofrecemos 23 días de vacaciones al año'))).toBeNull();
    expect(extractRequiredYears(normalizeText('Contrato indefinido desde 2026'))).toBeNull();
  });

  it('returns null when no requirement is stated', () => {
    expect(extractRequiredYears(normalizeText('Buscamos gente con ganas'))).toBeNull();
  });
});

describe('scoreSeniority', () => {
  it('rewards an explicit junior title', () => {
    expect(score('Junior Frontend Developer', 'Trabajarás con React.')).toBeGreaterThan(0.75);
  });

  it('rewards internship and trainee wording', () => {
    expect(score('Becario de desarrollo', 'Prácticas remuneradas.')).toBeGreaterThan(0.75);
    expect(score('Trainee Developer', 'Sin experiencia previa necesaria.')).toBeGreaterThan(0.75);
  });

  it('rewards recien titulado wording found only in the body', () => {
    expect(score('Desarrollador', 'Ideal para recién titulados.')).toBeGreaterThan(
      score('Desarrollador', 'Trabajo de desarrollo.'),
    );
  });

  it('does NOT read "3 años de experiencia" as junior', () => {
    const value = score('Desarrollador', 'Se requieren 3 años de experiencia en React.');
    expect(value).toBeLessThan(0.2);
  });

  it('heavily penalizes a senior title', () => {
    expect(score('Senior Backend Engineer', 'Liderarás el equipo.')).toBeLessThan(0.2);
  });

  it('heavily penalizes lead roles', () => {
    expect(score('Tech Lead', 'Gestionarás un equipo de 5 personas.')).toBeLessThan(0.2);
  });

  it('penalizes a senior mention in the body less than one in the title', () => {
    const inTitle = score('Senior Developer', 'Desarrollo web.');
    const inBody = score('Desarrollador', 'Reportarás al senior developer del equipo.');
    expect(inBody).toBeGreaterThan(inTitle);
  });

  it('still down-ranks a junior title that demands 3 years', () => {
    const junior = score('Junior Developer', 'Buscamos gente con ganas.');
    const juniorWithYears = score('Junior Developer', 'Se requieren 3 años de experiencia.');
    expect(juniorWithYears).toBeLessThan(junior);
  });

  it('rates an unlabelled posting at the configured baseline', () => {
    expect(score('Desarrollador de software', 'Buscamos gente con ganas.')).toBe(config.baseline);
  });

  it('always stays within 0..1', () => {
    const worst = score('Senior Lead Architect', 'Se requieren 10 años de experiencia demostrable.');
    const best = score('Junior Trainee Becario', 'Sin experiencia, 0-1 años, recién titulado.');
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(best).toBeLessThanOrEqual(1);
  });

  it('explains itself in the reason field', () => {
    const result = scoreSeniority(
      {
        normalizedTitle: normalizeText('Senior Developer'),
        normalizedBody: normalizeText('5 años de experiencia'),
      },
      config,
    );
    expect(result.reason).toContain('senior');
    expect(result.reason).toContain('5');
  });
});
