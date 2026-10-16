import { describe, expect, it } from 'vitest';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { judgeHardEligibility } from '../../src/domain/hard-eligibility.js';
import { makeJob } from '../helpers/make-job.js';

function judge(overrides: Parameters<typeof makeJob>[0]) {
  return judgeHardEligibility(
    makeJob(overrides),
    DEFAULT_JUNIOR_FILTER_CONFIG,
    DEFAULT_SCORING_CONFIG.location,
  );
}

describe('judgeHardEligibility - locality', () => {
  const accepted: readonly [string, string, string][] = [
    ['Madrid on-site', 'Madrid', 'Presencial.'],
    ['Madrid metro', 'Alcobendas', 'Presencial.'],
    ['Madrid hybrid', 'Madrid (Híbrido)', 'Modelo híbrido.'],
    ['remote in Spain', 'Remoto - España', 'Trabajo en remoto.'],
    ['remote Spain English', 'Remote, Spain', 'Fully remote.'],
    ['remote Europe', 'Remote Europe', 'Fully remote.'],
    ['remote worldwide', 'Remote - Worldwide', 'Work from anywhere.'],
    ['remote country unstated', 'Remote', 'Fully remote role.'],
    ['unknown location', '', 'Buscamos una persona para nuestro equipo.'],
    ['unrecognized location', 'Zona norte', 'Buscamos una persona.'],
  ];

  it.each(accepted)('keeps %s', (_name, location, description) => {
    const verdict = judge({ location, description });
    expect(verdict.eligible).toBe(true);
    expect(verdict.code).toBeNull();
  });

  const rejected: readonly [string, string, string][] = [
    ['on-site Barcelona', 'Barcelona', 'Presencial.'],
    ['hybrid Barcelona', 'Barcelona (Híbrido)', 'Modelo híbrido.'],
    ['on-site Berlin', 'Berlin, Germany', 'On-site.'],
    ['remote US only', 'Remote - United States', 'Fully remote.'],
    ['remote UK', 'Remote, United Kingdom', 'Fully remote.'],
    ['hybrid London', 'London (Hybrid)', 'Hybrid.'],
  ];

  it.each(rejected)('excludes %s with an auditable code', (_name, location, description) => {
    const verdict = judge({ location, description });
    expect(verdict.eligible).toBe(false);
    expect(verdict.code).toBe('location_incompatible');
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it('lets the location field beat a Madrid mention in the body', () => {
    const verdict = judge({
      location: 'Barcelona',
      description: 'Nuestra sede central esta en Madrid.',
    });
    expect(verdict.code).toBe('location_incompatible');
  });
});

describe('judgeHardEligibility - experience', () => {
  it.each([
    ['Se requieren 3 anos de experiencia', 'experience_over_limit'],
    ['5+ years of experience required', 'experience_over_limit'],
    ['Minimo 4 anos de experiencia', 'experience_over_limit'],
  ])('excludes %s', (description, code) => {
    const verdict = judge({ description });
    expect(verdict.eligible).toBe(false);
    expect(verdict.code).toBe(code);
    expect(verdict.reason).toMatch(/year/);
  });

  it.each([
    'Se requieren 2 anos de experiencia',
    '1 ano de experiencia',
    'Sin experiencia previa',
    'Buscamos una persona para nuestro equipo.',
  ])('keeps %s (0-2 years or unstated)', (description) => {
    const verdict = judge({ description });
    expect(verdict.eligible).toBe(true);
    expect(verdict.code).toBeNull();
  });
});

describe('judgeHardEligibility - seniority', () => {
  it.each([
    'Senior Frontend Developer',
    'Tech Lead',
    'Lead Developer',
    'Engineering Manager',
    'Project Manager',
    'Responsable Gerente de Sistemas',
  ])('excludes %s', (title) => {
    const verdict = judge({ title, description: 'Equipo.' });
    expect(verdict.eligible).toBe(false);
    expect(verdict.code).toBe('seniority_excluded');
  });

  it.each([
    'Junior Project Manager',
    'Associate Product Manager',
    'Graduate Program Manager',
    'Trainee Delivery Manager',
    'Entry Level Account Manager',
    'Developer Junior',
    'Desarrollador Backend',
  ])('keeps %s', (title) => {
    const verdict = judge({ title, description: 'Equipo.' });
    expect(verdict.eligible).toBe(true);
    expect(verdict.code).toBeNull();
  });

  it('does not let a junior word rescue a senior or lead title', () => {
    expect(judge({ title: 'Senior Associate Developer' }).code).toBe('seniority_excluded');
  });

  it('reports location first when several rules fail', () => {
    const verdict = judge({
      title: 'Senior Developer',
      location: 'Barcelona',
      description: '8 years of experience',
    });
    expect(verdict.code).toBe('location_incompatible');
  });
});
