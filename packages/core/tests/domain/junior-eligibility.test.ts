import { describe, expect, it } from 'vitest';
import { judgeJuniorEligibility } from '../../src/domain/junior-eligibility.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { makeJob } from '../helpers/make-job.js';

/**
 * FILTER B - junior eligibility.
 *
 * The asymmetry is the whole design, and it is not symmetric by accident:
 *
 *   a junior job wrongly DROPPED  -> the candidate never sees an opportunity
 *                                    they could have had. Invisible, permanent.
 *   a mid-level job wrongly SHOWN -> the candidate reads a title and scrolls
 *                                    past. Two seconds.
 *
 * So this filter only ever excludes on an EXPLICIT disqualifying signal. Silence
 * means inclusion. "Probably too senior" is not a signal, it is a guess, and the
 * candidate was clear that he does the judging.
 *
 * Note that it deliberately does NOT reuse `ScoringConfig.seniority.seniorTerms`.
 * That list is tuned for a soft penalty and contains terms like `manager`,
 * `experto` and `amplia experiencia`, which are fine as a nudge and far too
 * blunt as a delete.
 */

const config = DEFAULT_JUNIOR_FILTER_CONFIG;

function judge(title: string, description = '') {
  return judgeJuniorEligibility(makeJob({ title, description }), config);
}

describe('excludes only on an explicit disqualifying title', () => {
  it.each([
    ['Senior Frontend Engineer', 'senior'],
    ['Lead Software Engineer', 'lead'],
    ['Principal Engineer', 'principal'],
    ['Staff Engineer, Platform', 'staff'],
    ['Head of Engineering', 'head of'],
    ['Solutions Architect', 'architect'],
    ['Arquitecto de Software', 'arquitecto'],
    // Found by a real board run, not by imagination: "Global Director of
    // Revenue Enablement" cleared both filters and reached the list.
    ['Global Director of Revenue Enablement (Remote Europe)', 'director'],
    ['Jefe de Proyecto', 'jefe de'],
  ])('excludes %s', (title, signal) => {
    const verdict = judge(title);
    expect(verdict.eligible, title).toBe(false);
    expect(verdict.reason).toContain(signal);
  });

  it('matches on token boundaries, so "Leader" is not "lead"', () => {
    expect(judge('Community Leader Developer').eligible).toBe(true);
  });

  it('ignores a senior word that only appears in the description', () => {
    // "We are a senior-heavy team" is not a requirement on the candidate.
    expect(
      judge('Desarrollador Junior', 'Trabajaras junto a un equipo senior de diez personas.')
        .eligible,
    ).toBe(true);
  });
});

describe('excludes on an explicit years requirement of 3 or more', () => {
  it('excludes "3 años de experiencia"', () => {
    const verdict = judge('Desarrollador Full Stack', 'Se requieren 3 años de experiencia.');
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/3 year/);
  });

  it('excludes "5+ years of experience"', () => {
    expect(judge('Software Engineer', 'We ask for 5+ years of experience.').eligible).toBe(false);
  });

  it('excludes when the years requirement is in the title', () => {
    expect(judge('Developer con 4 años de experiencia').eligible).toBe(false);
  });

  it('includes "1 año de experiencia"', () => {
    expect(judge('Desarrollador Full Stack', 'Se valora 1 año de experiencia.').eligible).toBe(
      true,
    );
  });

  it('includes "2 años de experiencia": below the line is still eligible', () => {
    expect(judge('Desarrollador Backend', 'Buscamos 2 años de experiencia.').eligible).toBe(true);
  });

  it('does not read "23 días de vacaciones al año" as a seniority requirement', () => {
    expect(
      judge('Desarrollador Junior', 'Ofrecemos 23 días de vacaciones al año.').eligible,
    ).toBe(true);
  });
});

describe('silence means include - the candidate judges', () => {
  it('includes "Desarrollador Junior"', () => {
    const verdict = judge('Desarrollador Junior');
    expect(verdict.eligible).toBe(true);
  });

  it('includes "Desarrollador Full Stack" with no seniority stated at all', () => {
    const verdict = judge('Desarrollador Full Stack');
    expect(verdict.eligible).toBe(true);
    expect(verdict.reason).toMatch(/no explicit/i);
  });

  it('includes a posting with an empty description', () => {
    expect(judge('Frontend Developer', '').eligible).toBe(true);
  });

  it.each([
    'Software Engineer',
    'Programador Web',
    'QA Tester',
    'Ingeniero de Software',
    'React Developer (m/f/d)',
    'Full Stack Engineer',
    'Desarrollador .NET',
    'Power Platform Developer',
  ])('includes %s, whose seniority is simply unstated', (title) => {
    expect(judge(title).eligible, title).toBe(true);
  });

  it('includes a mid-level-sounding posting that never states a requirement', () => {
    // "Experience with React" is not "N years of experience".
    expect(
      judge('Desarrollador React', 'Experiencia con React, Redux y testing.').eligible,
    ).toBe(true);
  });
});

describe('the reason is always readable, because an exclusion must be arguable', () => {
  it('explains an inclusion', () => {
    expect(judge('Desarrollador Junior').reason.length).toBeGreaterThan(0);
  });

  it('explains an exclusion', () => {
    expect(judge('Senior Frontend Engineer').reason.length).toBeGreaterThan(0);
  });
});
