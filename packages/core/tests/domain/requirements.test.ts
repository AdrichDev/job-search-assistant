import { describe, expect, it } from 'vitest';
import { extractRequirements } from '../../src/domain/requirements.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { makeJob } from '../helpers/make-job.js';

function requirementsFor(overrides: Parameters<typeof makeJob>[0]) {
  return extractRequirements(makeJob(overrides), DEFAULT_SCORING_CONFIG);
}

describe('extractRequirements - years', () => {
  it('extracts the years of experience the posting demands', () => {
    const requirements = requirementsFor({
      description: 'Se requieren 5 anos de experiencia en desarrollo.',
    });
    expect(requirements.yearsRequired).toBe(5);
  });

  it('reports null when the posting stays silent about experience', () => {
    const requirements = requirementsFor({ description: 'Buscamos a alguien con ganas.' });
    expect(requirements.yearsRequired).toBeNull();
  });

  it('reuses the scoring parser, so a range still reports its upper bound', () => {
    const requirements = requirementsFor({
      description: 'Entre 3 y 5 anos de experiencia.',
    });
    expect(requirements.yearsRequired).toBe(5);
  });

  it('does not read an unrelated number as a seniority requirement', () => {
    const requirements = requirementsFor({
      description: 'Ofrecemos 23 dias de vacaciones al ano.',
    });
    expect(requirements.yearsRequired).toBeNull();
  });
});

describe('extractRequirements - seniority signals', () => {
  it('reports a junior signal found in the title', () => {
    const requirements = requirementsFor({ title: 'Desarrollador Junior Frontend' });
    expect(requirements.senioritySignals).toContainEqual({
      term: 'junior',
      level: 'junior',
      where: 'title',
    });
  });

  it('reports a senior signal found in the description', () => {
    const requirements = requirementsFor({
      title: 'Developer',
      description: 'Buscamos un perfil senior con amplia experiencia.',
    });
    const senior = requirements.senioritySignals.filter((signal) => signal.level === 'senior');
    expect(senior.length).toBeGreaterThan(0);
    expect(senior.every((signal) => signal.where === 'description')).toBe(true);
  });

  it('returns no signals when the posting states no seniority at all', () => {
    const requirements = requirementsFor({
      title: 'Developer',
      description: 'Trabajaras en nuestro equipo de producto.',
    });
    expect(requirements.senioritySignals).toEqual([]);
  });
});

describe('extractRequirements - stack', () => {
  it('lists the matched technologies the UI renders as chips', () => {
    const requirements = requirementsFor({
      description: 'Stack: React, TypeScript y Tailwind con Git.',
    });
    expect(requirements.matchedStack).toContain('react');
    expect(requirements.matchedStack).toContain('typescript');
    expect(requirements.matchedStack).toContain('git');
  });

  it('reports the winning CV variant alongside the stack', () => {
    const requirements = requirementsFor({
      description: 'Power Apps, Power Automate y Dynamics 365.',
    });
    expect(requirements.cvVariant).toBe('microsoft');
  });

  it('returns an empty stack rather than failing on a posting with no technology', () => {
    const requirements = requirementsFor({ description: 'Atencion al cliente en tienda.' });
    expect(requirements.matchedStack).toEqual([]);
    expect(requirements.cvVariant).toBe('general');
  });

  it('does not duplicate a keyword matched by both a lane and the general bucket', () => {
    const requirements = requirementsFor({
      description: 'React, TypeScript, JavaScript, SQL, Git, API REST.',
    });
    expect(new Set(requirements.matchedStack).size).toBe(requirements.matchedStack.length);
  });
});

describe('extractRequirements - english', () => {
  it('flags a demand above B1 as advanced', () => {
    const requirements = requirementsFor({ description: 'Imprescindible ingles C1.' });
    expect(requirements.englishRequired).toBe('advanced');
  });

  it('flags a B2 demand as intermediate', () => {
    const requirements = requirementsFor({ description: 'Nivel de ingles B2 valorable.' });
    expect(requirements.englishRequired).toBe('intermediate');
  });

  it('flags a B1 demand as basic', () => {
    const requirements = requirementsFor({ description: 'Ingles B1 suficiente.' });
    expect(requirements.englishRequired).toBe('basic');
  });

  it('reports "not stated" rather than guessing when English is never mentioned', () => {
    const requirements = requirementsFor({ description: 'Buscamos desarrollador para Madrid.' });
    expect(requirements.englishRequired).toBe('not_stated');
  });
});

describe('extractRequirements - work mode', () => {
  it('detects remote work', () => {
    const requirements = requirementsFor({ description: 'Trabajo en remoto desde Espana.' });
    expect(requirements.workMode).toBe('remote');
  });

  it('prefers hybrid over remote when both are mentioned', () => {
    const requirements = requirementsFor({
      description: 'Modelo hibrido con dos dias en remoto.',
    });
    expect(requirements.workMode).toBe('hybrid');
  });

  it('reads a recognized city with no remote wording as on-site', () => {
    const requirements = requirementsFor({
      location: 'Madrid',
      description: 'Oficina en el centro.',
    });
    expect(requirements.workMode).toBe('onsite');
  });

  it('falls back to unknown when the location is unrecognizable', () => {
    const requirements = requirementsFor({
      location: 'Nowhereville',
      description: 'Un puesto interesante.',
    });
    expect(requirements.workMode).toBe('unknown');
  });
});
