import { describe, expect, it } from 'vitest';
import { detectEnglishOnly, scoreLanguage } from '../../src/domain/scoring/language.js';
import { normalizeText } from '../../src/domain/text.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';

const config = DEFAULT_SCORING_CONFIG.language;

const SPANISH_POSTING =
  'Buscamos un desarrollador junior para nuestro equipo en Madrid con ganas de aprender.';
const ENGLISH_POSTING =
  'We are looking for a developer to join our team. You will work with the product owner.';

function run(text: string) {
  const normalized = normalizeText(text);
  return scoreLanguage(normalized, detectEnglishOnly(normalized, config), config);
}

describe('detectEnglishOnly', () => {
  it('flags a posting written entirely in English', () => {
    expect(detectEnglishOnly(normalizeText(ENGLISH_POSTING), config)).toBe(true);
  });

  it('does not flag a Spanish posting', () => {
    expect(detectEnglishOnly(normalizeText(SPANISH_POSTING), config)).toBe(false);
  });

  it('does not flag a Spanish posting that borrows English words', () => {
    const mixed = `${SPANISH_POSTING} Stack: React and TypeScript with our team.`;
    expect(detectEnglishOnly(normalizeText(mixed), config)).toBe(false);
  });

  it('does not flag a very short English fragment', () => {
    expect(detectEnglishOnly(normalizeText('Remote job'), config)).toBe(false);
  });
});

describe('scoreLanguage', () => {
  it('gives full marks to a Spanish posting with no English requirement', () => {
    expect(run(SPANISH_POSTING).value).toBe(config.scores.neutral);
  });

  it('gives full marks when B1 or basic English is enough', () => {
    expect(run(`${SPANISH_POSTING} Se pide inglés B1.`).value).toBe(config.scores.friendly);
  });

  it('heavily penalizes a C1 requirement', () => {
    expect(run(`${SPANISH_POSTING} Imprescindible inglés C1.`).value).toBe(config.scores.high);
  });

  it('heavily penalizes fluent or native English requirements', () => {
    expect(run(`${SPANISH_POSTING} Fluent English required.`).value).toBe(config.scores.high);
    expect(run(`${SPANISH_POSTING} Se requiere inglés nativo.`).value).toBe(config.scores.high);
  });

  it('applies a moderate penalty to B2', () => {
    expect(run(`${SPANISH_POSTING} Nivel de inglés B2.`).value).toBe(config.scores.medium);
  });

  it('lets the strictest requirement win when several are mentioned', () => {
    expect(run(`${SPANISH_POSTING} Inglés B2, idealmente C1.`).value).toBe(config.scores.high);
  });

  it('penalizes an English-only posting even without an explicit requirement', () => {
    expect(run(ENGLISH_POSTING).value).toBe(config.scores.englishOnly);
  });

  it('never hard-excludes: the value stays above zero', () => {
    expect(run(`${ENGLISH_POSTING} Native English speaker required, C2.`).value).toBeGreaterThan(0);
  });

  it('explains itself', () => {
    expect(run(`${SPANISH_POSTING} Imprescindible inglés C1.`).reason.toLowerCase()).toContain('c1');
  });
});
