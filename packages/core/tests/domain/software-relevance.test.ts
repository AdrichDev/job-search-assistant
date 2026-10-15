import { describe, expect, it } from 'vitest';
import { scoreSoftwareRelevance } from '../../src/domain/scoring/software-relevance.js';
import { normalizeText } from '../../src/domain/text.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';

const config = DEFAULT_SCORING_CONFIG.softwareRelevance;

/**
 * DOMAIN RELEVANCE, not stack preference.
 *
 * This dimension answers exactly one question: "is this a software job at all?"
 * Which software lane the candidate prefers (React vs Microsoft vs backend) is
 * `scoreStack`'s business and is never decided here.
 */
function run(title: string, description = '') {
  return scoreSoftwareRelevance(
    {
      normalizedTitle: normalizeText(title),
      normalizedText: normalizeText(`${title} ${description}`),
    },
    config,
  );
}

describe('scoreSoftwareRelevance', () => {
  describe('role shape in the title is sufficient proof', () => {
    it.each([
      ['Desarrollador Full Stack'],
      ['Programador/A Junior'],
      ['Qa Tester'],
      ['Junior Software Engineer'],
      ['Frontend Developer'],
      ['DevOps Engineer'],
      ['Data Engineer'],
      ['Ingeniero de Software Junior'],
    ])('accepts %s even with an empty description', (title) => {
      const result = run(title);
      expect(result.isSoftware).toBe(true);
      expect(result.value).toBeGreaterThanOrEqual(config.gateThreshold);
    });
  });

  describe('technical stack in the body is sufficient proof', () => {
    it('accepts a posting whose title says nothing but whose body is technical', () => {
      const result = run('Consultor Junior', 'Trabajaras con React, TypeScript y Node.js.');
      expect(result.isSoftware).toBe(true);
    });

    it('needs more than one unambiguous technology when the title is silent', () => {
      const one = run('Consultor Junior', 'Se valora Python.');
      const two = run('Consultor Junior', 'Se valora Python y Docker.');
      expect(two.value).toBeGreaterThan(one.value);
    });
  });

  describe('non-software domains are rejected', () => {
    it.each([
      ['Se Necesitan Odontólogos', 'Clinica dental en Madrid, trato con pacientes.'],
      ['Odontólogo(A)', 'Buscamos odontologo para nuestra clinica.'],
      ['Analista Junior Estrategia Call Center', 'Analisis de la operativa del call center.'],
      ['Ingeniero/A Comercial Junior (H/M) Otis Madrid', 'Venta de ascensores y trato comercial.'],
      ['Junior HR para multinacional x sustitución', 'Recursos humanos, nominas y seleccion.'],
      ['Junior Sales Executive – Fintech Solutions', 'Sales executive for our commercial team.'],
      ['Administrativo/A Contabilidad', 'Tareas administrativas y de contabilidad.'],
      ['PMO Junior – Calidad de Proyecto, Compras y Proveedores', 'Compras y proveedores.'],
      ['Junior Art Director (Graduate Program)', 'Direccion de arte y creatividad publicitaria.'],
      ['Ingeniero/a de Procesos Senior', 'Mejora de procesos industriales en planta.'],
    ])('rejects %s', (title, description) => {
      const result = run(title, description);
      expect(result.isSoftware).toBe(false);
      expect(result.value).toBeLessThan(config.gateThreshold);
    });
  });

  describe('ambiguous business tooling never proves relevance on its own', () => {
    it('rejects the real Treasury Administrator posting that only mentions ERP', () => {
      const result = run('Treasury Administrator', 'Treasury operations, cash management and ERP.');
      expect(result.isSoftware).toBe(false);
    });

    it('rejects an accounting role that merely lists SQL and Excel', () => {
      const result = run('Administrativo Contabilidad', 'Manejo de Excel avanzado y consultas SQL.');
      expect(result.isSoftware).toBe(false);
    });

    it('still accepts a Dynamics 365 developer, because that is a real engineering stack', () => {
      const result = run(
        'Consultor/A Dynamics 365 Bc',
        'Analisis y desarrollo sobre Dynamics 365 Business Central y Power Platform.',
      );
      expect(result.isSoftware).toBe(true);
    });
  });

  describe('does not overcorrect', () => {
    it('keeps a junior software job whose description is sparse', () => {
      expect(run('Desarrollador Junior').isSoftware).toBe(true);
    });

    it('keeps a software job that happens to mention a non-software word', () => {
      const result = run(
        'Frontend Developer',
        'Trabajaras con React junto al equipo comercial y de ventas.',
      );
      expect(result.isSoftware).toBe(true);
    });

    it('keeps a technical posting that is drowned in non-software vocabulary', () => {
      const result = run(
        'Full Stack Engineer',
        'Equipo de ventas, marketing y recursos humanos. Stack: React, Node.js, Docker, PostgreSQL.',
      );
      expect(result.isSoftware).toBe(true);
    });
  });

  it('explains itself', () => {
    expect(run('Desarrollador React').reason.length).toBeGreaterThan(0);
    expect(run('Odontólogo').reason.length).toBeGreaterThan(0);
  });

  it('always produces a 0..1 value', () => {
    for (const title of ['Desarrollador React Node Docker Python Java', 'Odontólogo comercial ventas hr']) {
      const { value } = run(title, title);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
