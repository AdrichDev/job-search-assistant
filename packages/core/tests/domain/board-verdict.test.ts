import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import {
  isSoftwareOpening,
  judgeBoardVerdict,
  softwareOpenings,
} from '../../src/domain/board-verdict.js';
import { makeJob } from '../helpers/make-job.js';

const RELEVANCE = DEFAULT_SCORING_CONFIG.softwareRelevance;

/**
 * The three-bar admission test for a company board, as a pure function.
 *
 * It exists because the bar was previously enforced by a human reading titles
 * off a terminal, and that is how `Sixt` (35 Spanish openings, all of them car
 * rental agents) nearly got committed. The gate that decides whether a posting
 * reaches the candidate is `scoreSoftwareRelevance`; the gate that decides
 * whether a BOARD is worth a request per run must be the same one, or the two
 * disagree and the list fills up with boards whose every posting is discarded
 * downstream.
 */
describe('isSoftwareOpening', () => {
  it('accepts a posting whose title names a software role', () => {
    const job = makeJob({ title: 'Frontend Developer', description: '' });
    expect(isSoftwareOpening(job, RELEVANCE)).toBe(true);
  });

  it('accepts a Dynamics consultant whose title says only "Consultor"', () => {
    // The exact posting shape this whole sweep is looking for: a Spanish
    // Microsoft partner writes "Consultor/a" in the title and puts the stack in
    // the body. Judging on the title alone would reject the candidate's edge.
    const job = makeJob({
      title: 'Consultor/a Junior',
      description: 'Implantacion de Dynamics 365 Business Central y Power Apps para clientes.',
    });
    expect(isSoftwareOpening(job, RELEVANCE)).toBe(true);
  });

  it('rejects a hotel receptionist', () => {
    const job = makeJob({
      title: 'Recepcionista de hotel',
      description: 'Atencion al cliente en recepcion, turnos rotativos.',
    });
    expect(isSoftwareOpening(job, RELEVANCE)).toBe(false);
  });

  it('rejects a sales role whose title contests its own engineering word', () => {
    const job = makeJob({
      title: 'Sales Engineer',
      description: 'Cartera de clientes, objetivos comerciales y ventas.',
    });
    expect(isSoftwareOpening(job, RELEVANCE)).toBe(false);
  });

  it('reads the same normalized haystack the pipeline scores on', () => {
    // Title + company + location + description. A stack named only in the
    // company field must not count for more here than it does downstream.
    const job = makeJob({
      title: 'Becario',
      company: 'ACME',
      description: 'Trabajaras con React y TypeScript en nuestro equipo.',
    });
    expect(isSoftwareOpening(job, RELEVANCE)).toBe(true);
  });
});

describe('softwareOpenings', () => {
  it('keeps only the software postings, in input order', () => {
    const jobs = [
      makeJob({ title: 'Camarero de sala', description: 'Servicio de mesas.' }),
      makeJob({ title: 'Backend Engineer', description: '' }),
      makeJob({ title: 'Limpieza de oficinas', description: 'Turno de tarde.' }),
      makeJob({ title: 'Desarrollador Java', description: '' }),
    ];

    expect(softwareOpenings(jobs, RELEVANCE).map((job) => job.title)).toEqual([
      'Backend Engineer',
      'Desarrollador Java',
    ]);
  });

  it('returns nothing for an empty board rather than throwing', () => {
    expect(softwareOpenings([], RELEVANCE)).toEqual([]);
  });
});

describe('judgeBoardVerdict', () => {
  it('passes a board with Spanish openings and software among them', () => {
    expect(
      judgeBoardVerdict({ error: null, spainOpenings: 12, softwareOpenings: 3 }),
    ).toBe('pass');
  });

  it('reports an unreachable board even when counts were somehow collected', () => {
    // Error wins. A count taken from a board that then failed is not evidence.
    expect(
      judgeBoardVerdict({ error: 'HTTP 404', spainOpenings: 9, softwareOpenings: 9 }),
    ).toBe('unreachable');
  });

  it('separates "answered but nothing in Spain" from "unreachable"', () => {
    // THE SmartRecruiters CASE: HTTP 200, totalFound 0. Reachability proves
    // nothing about whether the company is on that ATS at all.
    expect(
      judgeBoardVerdict({ error: null, spainOpenings: 0, softwareOpenings: 0 }),
    ).toBe('no-spain-openings');
  });

  it('separates "hiring in Spain but not for software" from both', () => {
    // Sixt: 35 Spanish openings, zero software. A board whose entire Spanish
    // presence is filtered out downstream is still a request per run.
    expect(
      judgeBoardVerdict({ error: null, spainOpenings: 35, softwareOpenings: 0 }),
    ).toBe('no-software-openings');
  });
});
