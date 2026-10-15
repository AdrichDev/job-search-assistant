import { describe, expect, it } from 'vitest';
import { scoreStack } from '../../src/domain/scoring/stack.js';
import { normalizeText } from '../../src/domain/text.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';

const config = DEFAULT_SCORING_CONFIG.stack;

function run(text: string) {
  return scoreStack(normalizeText(text), config);
}

describe('scoreStack', () => {
  it('picks the frontend lane for a React/Next/TypeScript posting', () => {
    const result = run('Buscamos alguien con React, Next.js, TypeScript y Tailwind');
    expect(result.cvVariant).toBe('frontend');
    expect(result.value).toBeGreaterThan(0.6);
  });

  it('picks the microsoft lane for a Power Platform posting', () => {
    const result = run('Consultor de Power Apps, Power Automate y Dataverse');
    expect(result.cvVariant).toBe('microsoft');
    expect(result.value).toBeGreaterThan(0.6);
  });

  it('picks the microsoft lane for Business Central / Navision', () => {
    expect(run('Desarrollador Business Central Navision Dynamics 365').cvVariant).toBe('microsoft');
  });

  it('takes the best lane when both appear', () => {
    const result = run('React, TypeScript, Tailwind, Next.js y algo de Dataverse');
    expect(result.cvVariant).toBe('frontend');
  });

  it('falls back to the general variant when no lane keyword appears', () => {
    const result = run('Buscamos perfil con Java, SQL, Git y metodología Scrum');
    expect(result.cvVariant).toBe('general');
    expect(result.value).toBeGreaterThan(0);
  });

  it('scores a posting with no recognizable technology at zero', () => {
    const result = run('Se busca persona responsable y con ganas de aprender');
    expect(result.value).toBe(0);
    expect(result.cvVariant).toBe('general');
  });

  it('lets general keywords lift a lane match', () => {
    const bare = run('React');
    const enriched = run('React con SQL, Git, API REST y Scrum');
    expect(enriched.value).toBeGreaterThan(bare.value);
  });

  it('caps the value at 1', () => {
    const result = run(
      'React Next.js TypeScript JavaScript Tailwind CSS HTML frontend con SQL MySQL Java Python Git API REST Scrum Agile Node',
    );
    expect(result.value).toBeLessThanOrEqual(1);
  });

  /**
   * Regression: the real run put "Treasury Administrator" (GMV) in the
   * `microsoft` lane. The offending keywords were `erp` and `dynamics` - generic
   * business vocabulary that finance, HR and ops ads use constantly. They are
   * not Microsoft ENGINEERING signals and no longer live in that lane.
   */
  it('does not put a treasury role in the microsoft lane because it says ERP', () => {
    const result = run('Treasury Administrator - treasury operations, cash management and ERP');
    expect(result.cvVariant).not.toBe('microsoft');
  });

  it('does not put an HR role in the microsoft lane because it says team dynamics', () => {
    const result = run('Junior HR - you will understand the dynamics of a growing team');
    expect(result.cvVariant).not.toBe('microsoft');
  });

  it('keeps the microsoft lane for the specific product names', () => {
    expect(run('Consultor Dynamics 365 Business Central').cvVariant).toBe('microsoft');
    expect(run('Desarrollador ASP.NET y C# sobre Azure').cvVariant).toBe('microsoft');
  });

  it('reports which keywords matched', () => {
    const result = run('React y TypeScript');
    expect(result.matchedKeywords).toContain('react');
    expect(result.matchedKeywords).toContain('typescript');
    expect(result.reason.toLowerCase()).toContain('frontend');
  });
});
