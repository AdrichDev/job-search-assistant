import { describe, expect, it } from 'vitest';
import { scoreJob } from '../../src/domain/scoring/score-job.js';
import { SCORE_DIMENSIONS } from '../../src/domain/scoring/types.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { REFERENCE_NOW, daysAgo, makeJob } from '../helpers/make-job.js';

const config = DEFAULT_SCORING_CONFIG;

const IDEAL_JOB = makeJob({
  title: 'Desarrollador Junior Frontend',
  company: 'ACME',
  location: 'Madrid',
  description:
    'Buscamos un desarrollador junior sin experiencia previa para nuestro equipo en Madrid. Stack: React, Next.js, TypeScript y Tailwind. Se valora SQL y Git. Inglés B1.',
  postedAt: daysAgo(1),
});

const HOSTILE_JOB = makeJob({
  title: 'Senior Software Architect',
  company: 'Globex',
  location: 'Barcelona',
  description:
    'We are looking for a senior architect with 10 years of experience. Native English required and you will lead the team.',
  postedAt: daysAgo(28),
});

describe('scoreJob', () => {
  it('produces a score between 0 and 100', () => {
    for (const job of [IDEAL_JOB, HOSTILE_JOB, makeJob()]) {
      const { score } = scoreJob(job, config, REFERENCE_NOW);
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
    }
  });

  it('ranks the ideal job far above the hostile one', () => {
    const ideal = scoreJob(IDEAL_JOB, config, REFERENCE_NOW).score.total;
    const hostile = scoreJob(HOSTILE_JOB, config, REFERENCE_NOW).score.total;
    expect(ideal).toBeGreaterThan(75);
    expect(hostile).toBeLessThan(30);
    expect(ideal - hostile).toBeGreaterThan(45);
  });

  it('reports one breakdown entry per dimension', () => {
    const { score } = scoreJob(IDEAL_JOB, config, REFERENCE_NOW);
    expect(score.breakdown.map((item) => item.dimension)).toEqual([...SCORE_DIMENSIONS]);
  });

  it('gives every breakdown entry a non-empty human-readable reason', () => {
    const { score } = scoreJob(IDEAL_JOB, config, REFERENCE_NOW);
    for (const item of score.breakdown) {
      expect(item.reason.length).toBeGreaterThan(0);
      expect(item.value).toBeGreaterThanOrEqual(0);
      expect(item.value).toBeLessThanOrEqual(1);
    }
  });

  it('makes contributions add up to the total', () => {
    const { score } = scoreJob(IDEAL_JOB, config, REFERENCE_NOW);
    const sum = score.breakdown.reduce((acc, item) => acc + item.contribution, 0);
    expect(sum).toBeCloseTo(score.total, 1);
  });

  it('exposes the winning CV variant', () => {
    expect(scoreJob(IDEAL_JOB, config, REFERENCE_NOW).score.cvVariant).toBe('frontend');
    const microsoft = makeJob({
      title: 'Consultor Junior Power Platform',
      description: 'Power Apps, Power Automate y Dataverse en Madrid.',
    });
    expect(scoreJob(microsoft, config, REFERENCE_NOW).score.cvVariant).toBe('microsoft');
  });

  it('is deterministic', () => {
    const a = scoreJob(IDEAL_JOB, config, REFERENCE_NOW).score.total;
    const b = scoreJob(IDEAL_JOB, config, REFERENCE_NOW).score.total;
    expect(a).toBe(b);
  });

  it('exposes the pre-gate total alongside the gated one', () => {
    const { score } = scoreJob(IDEAL_JOB, config, REFERENCE_NOW);
    const sum = score.breakdown.reduce((acc, item) => acc + item.contribution, 0);
    expect(sum).toBeCloseTo(score.totalBeforeGate, 1);
  });

  it('respects the configured weights', () => {
    const seniorityOnly = {
      ...config,
      weights: {
        seniorityFit: 1,
        stackMatch: 0,
        locationFit: 0,
        languageFit: 0,
        recency: 0,
      },
    };
    const { score } = scoreJob(IDEAL_JOB, seniorityOnly, REFERENCE_NOW);
    const seniority = score.breakdown.find((item) => item.dimension === 'seniorityFit');
    expect(seniority).toBeDefined();
    expect(score.total).toBeCloseTo((seniority?.value ?? 0) * 100, 1);
  });
});

/**
 * The defect this suite exists for: the score used to be purely additive, so a
 * dentist collected ~57 points from seniority + location + language + recency
 * while contributing nothing technical. Relevance has to MULTIPLY, otherwise
 * there is always some combination of the other dimensions that rescues it.
 */
describe('the software-relevance gate', () => {
  const DENTIST = makeJob({
    title: 'Se Necesitan Odontólogos',
    company: 'Dentego',
    location: 'Madrid',
    description: 'Buscamos odontologo junior para nuestra clinica dental en Madrid.',
    postedAt: REFERENCE_NOW,
  });

  it('zeroes a posting with no software signal at all', () => {
    const { score } = scoreJob(DENTIST, config, REFERENCE_NOW);
    expect(score.softwareRelevance.isSoftware).toBe(false);
    expect(score.total).toBe(0);
  });

  it('still shows what the posting would have scored without the gate', () => {
    const { score } = scoreJob(DENTIST, config, REFERENCE_NOW);
    // The additive part is exactly the ~57 points the real run handed out.
    expect(score.totalBeforeGate).toBeGreaterThan(50);
  });

  it('cannot be rescued by maxing out every other dimension', () => {
    // Perfect seniority, perfect location, friendly language, posted today.
    const perfectlyIrrelevant = makeJob({
      title: 'Odontólogo Junior sin experiencia',
      company: 'Dentego',
      location: 'Madrid',
      description:
        'Recien titulado, primer empleo, no se requiere experiencia. Madrid centro. No se requiere ingles.',
      postedAt: REFERENCE_NOW,
    });
    const { score } = scoreJob(perfectlyIrrelevant, config, REFERENCE_NOW);

    // 69.2/100 additive: everything a posting can earn WITHOUT being technical.
    // It out-scores most of the real software jobs in the live run.
    expect(score.totalBeforeGate).toBeGreaterThan(65);
    expect(score.total).toBe(0);
  });

  it('is multiplicative, not additive: total = totalBeforeGate x relevance', () => {
    for (const job of [IDEAL_JOB, HOSTILE_JOB, DENTIST]) {
      const { score } = scoreJob(job, config, REFERENCE_NOW);
      const expected = score.totalBeforeGate * score.softwareRelevance.value;
      expect(score.total).toBeCloseTo(Math.round(expected * 10) / 10, 5);
    }
  });

  it('raising a non-relevance weight can never lift a zero-relevance posting', () => {
    const locationHeavy = {
      ...config,
      weights: {
        seniorityFit: 0.01,
        stackMatch: 0.01,
        locationFit: 100,
        languageFit: 0.01,
        recency: 0.01,
      },
    };
    expect(scoreJob(DENTIST, locationHeavy, REFERENCE_NOW).score.total).toBe(0);
  });

  it('does not zero a genuine software job with a weak stack match', () => {
    const sparse = makeJob({
      title: 'Desarrollador Junior',
      company: 'ACME',
      location: 'Madrid',
      description: 'Incorporamos perfil junior a nuestro equipo.',
      postedAt: REFERENCE_NOW,
    });
    const { score } = scoreJob(sparse, config, REFERENCE_NOW);

    expect(score.breakdown.find((item) => item.dimension === 'stackMatch')?.value).toBe(0);
    expect(score.softwareRelevance.isSoftware).toBe(true);
    expect(score.total).toBeGreaterThan(50);
  });
});
