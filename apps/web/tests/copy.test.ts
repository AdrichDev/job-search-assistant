import { describe, expect, it } from 'vitest';
import {
  APPLICATION_OUTCOMES,
  SCORE_DIMENSIONS,
  type ApplicationRepository,
  type QueueApplicationStatus,
} from '@job-queue/core';
import { ACTION_MESSAGES } from '@/copy/action-messages';
import { ES, cvVariantLabel, dimensionLabel, translateActionMessage } from '@/copy/es';
import { applyToJob, setOutcome, type WriteDeps } from '@/server/use-cases';

/**
 * The copy module is a SEAM, and seams rot silently.
 *
 * The failure this guards against is specific and cheap to hit: someone adds a
 * seventh application outcome, or a sixth score dimension, or a new server
 * action message - and the interface quietly shows an English string, or an
 * enum key like `no_reply`, to a user who asked for Spanish. TypeScript catches
 * the `Record<Enum, string>` cases at compile time; these tests catch the
 * lookups that go through a string and would otherwise fall back at runtime.
 *
 * Markup is deliberately NOT tested here. Asserting that a heading renders is
 * coverage theatre; asserting that every domain value HAS Spanish words is the
 * part that actually breaks.
 */

const ALL_STATUSES: readonly QueueApplicationStatus[] = ['not_applied', ...APPLICATION_OUTCOMES];

/** Never reached: the guard clauses under test return before touching deps. */
const UNUSED_DEPS: WriteDeps = {
  applicationRepository: {
    list: async () => [],
    findByJobId: async () => null,
    record: async () => {
      throw new Error('not reached');
    },
    updateOutcome: async () => {
      throw new Error('not reached');
    },
  } satisfies ApplicationRepository,
  loadQueue: async () => null,
  now: () => new Date('2026-09-08T00:00:00.000Z'),
};

function isSpanishSentence(value: string): boolean {
  return value.trim().length > 0 && !value.includes('_') && value !== value.toLowerCase();
}

describe('Spanish copy completeness', () => {
  it('gives every application status a Spanish label', () => {
    for (const status of ALL_STATUSES) {
      expect(ES.status[status], status).toBeTruthy();
      expect(ES.status[status]).not.toContain('_');
    }
  });

  it('gives every outcome option a Spanish label', () => {
    for (const outcome of APPLICATION_OUTCOMES) {
      expect(ES.outcomeOption[outcome], outcome).toBeTruthy();
      expect(ES.outcomeOption[outcome]).not.toContain('_');
    }
  });

  it('gives every score dimension a Spanish label', () => {
    for (const dimension of SCORE_DIMENSIONS) {
      expect(dimensionLabel(dimension), dimension).not.toBe(dimension);
      expect(dimensionLabel(dimension)).toBeTruthy();
    }
  });

  it('gives every CV variant a Spanish label', () => {
    for (const variant of ['frontend', 'microsoft', 'general'] as const) {
      expect(cvVariantLabel(variant)).toContain('CV');
    }
  });

  it('uses the agreed domain vocabulary', () => {
    expect(ES.status.applied).toBe('Aplicada');
    expect(ES.status.no_reply).toBe('Sin respuesta');
    expect(ES.status.rejected).toBe('Rechazada');
    expect(ES.status.screening).toBe('Preselección');
    expect(ES.status.interview).toBe('Entrevista');
    expect(ES.status.offer).toBe('Oferta');
    expect(ES.stats.responseRate).toBe('Tasa de respuesta');
  });
});

describe('server action message translation', () => {
  it('translates every message a server action can return', () => {
    for (const message of Object.values(ACTION_MESSAGES)) {
      const translated = translateActionMessage(message);

      expect(translated, message).not.toBe(message);
      expect(isSpanishSentence(translated), translated).toBe(true);
    }
  });

  it('falls back to the raw message rather than rendering nothing', () => {
    expect(translateActionMessage('Something new the server invented')).toBe(
      'Something new the server invented',
    );
  });

  /*
   * The wiring test that matters: a real call through the real use case, whose
   * result is fed to the real translator. A refactor that changes the server
   * message without updating the copy module fails here, not in production.
   */
  it('translates what applyToJob actually returns', async () => {
    const result = await applyToJob(undefined, UNUSED_DEPS);

    expect(result.ok).toBe(false);
    expect(translateActionMessage(result.message)).toBe('Falta el identificador de la oferta.');
  });

  it('translates what setOutcome actually returns', async () => {
    const result = await setOutcome(undefined, undefined, undefined, UNUSED_DEPS);

    expect(result.ok).toBe(false);
    expect(translateActionMessage(result.message)).toBe('Falta la oferta o el estado.');
  });

  it('translates the queue-unavailable path a first launch hits', async () => {
    const result = await applyToJob('any-job', UNUSED_DEPS);

    expect(translateActionMessage(result.message)).toBe(
      'No hay cola disponible. Ejecuta el pipeline primero.',
    );
  });
});

describe('Spanish grammar in generated strings', () => {
  it('agrees in number when describing how recently a job was posted', () => {
    expect(ES.card.postedAgo(1)).toBe('Publicada hace 1 día');
    expect(ES.card.postedAgo(4)).toBe('Publicada hace 4 días');
  });

  it('agrees in number when counting offers', () => {
    expect(ES.header.subtitle(1, 'Adrian')).toContain('1 oferta');
    expect(ES.header.subtitle(13, 'Adrian')).toContain('13 ofertas');
  });

  it('agrees in number in the prominent total', () => {
    expect(ES.queue.total(1)).toBe('1 oferta');
    expect(ES.queue.total(13)).toBe('13 ofertas');
  });

  it('leads the list with offers, not with a score', () => {
    // The heading a reader sees first must be a count of offers. Reinstating a
    // score-led headline is the regression this guards.
    expect(ES.queue.total(7)).not.toMatch(/punt/i);
    expect(ES.queue.heading).toBe('Ofertas');
  });

  it('states plainly that the score does not order or filter the list', () => {
    expect(ES.method.footerNote).toContain('no decide');
    expect(ES.score.intro).toContain('secundario');
  });

  it('agrees in number when counting filtered results', () => {
    expect(ES.queue.showing(1, 1)).toBe('Mostrando 1 de 1 oferta');
    expect(ES.queue.showing(3, 13)).toBe('Mostrando 3 de 13 ofertas');
  });

  it('agrees in number when counting failed source queries', () => {
    expect(ES.degraded.failedTitle(1)).toContain('1 consulta de origen falló');
    expect(ES.degraded.failedTitle(2)).toContain('2 consultas de origen fallaron');
  });

  it('agrees in number when reporting required experience', () => {
    expect(ES.card.yearsRequired(1)).toBe('1 año de experiencia');
    expect(ES.card.yearsRequired(3)).toBe('3 años de experiencia');
  });
});

describe('apply button copy', () => {
  it('names both halves of what the click does', () => {
    expect(ES.apply.dualPurpose).toContain('pestaña nueva');
    expect(ES.apply.dualPurpose).toContain('registra la postulación');
  });

  /*
   * WCAG 1.4.1: applied and not-applied must be distinguishable without colour.
   * The labels themselves have to differ, so a greyscale screenshot still reads.
   */
  it('distinguishes applied from not-applied in words, not only in colour', () => {
    expect(ES.apply.action).not.toBe(ES.apply.applied);
    expect(ES.apply.applied).toBe('Aplicada');
  });

  it('gives a screen reader the full consequence of the link', () => {
    const label = ES.apply.screenReader('Junior Frontend Developer');

    expect(label).toContain('Junior Frontend Developer');
    expect(label).toContain('registra la postulación');
  });
});

describe('empty state copy', () => {
  it('separates a failed run from a genuinely empty market', () => {
    expect(ES.emptyQueue.headingDegraded).not.toBe(ES.emptyQueue.headingEmpty);
    expect(ES.emptyQueue.bodyDegraded).toContain('no se han sobrescrito');
  });

  it('tells the user what to do next', () => {
    // `seed:queue` used to be the recommended recovery. It now refuses, because
    // the fixture it seeded from has no real URLs - so pointing a user at it
    // would be pointing them at a command that cannot help them.
    expect(ES.emptyQueue.stepBoards).toContain('--source=boards');
  });
});

/**
 * THE UNVERIFIED MARK.
 *
 * A posting the checker could not vouch for is KEPT - only 404 and 410 remove
 * anything - but it must not be presented as if the check had succeeded. This
 * is the honest-labelling half of the removal rule, and the copy has two jobs
 * that pull against each other: it has to say "we could not verify this", and
 * it has to avoid making a routine 403 from a bot-protected careers page look
 * like a problem with the vacancy.
 */
describe('liveness copy', () => {
  it('says plainly that the link could not be verified', () => {
    expect(ES.card.unverifiedBadgeTitle).toContain('No pudimos verificar este enlace');
  });

  it('keeps the badge itself short enough to sit beside the other chips', () => {
    expect(ES.card.unverifiedBadge.length).toBeLessThanOrEqual(16);
  });

  it('says the offer was KEPT, so the mark does not read as a warning about the job', () => {
    /*
     * The distinction the user needs: this is a statement about OUR check, not
     * about the vacancy. Without it, a 403 from a careers site reads as "this
     * job is probably dead", which is exactly backwards - it is the postings we
     * DID verify as gone that were removed.
     */
    const title = ES.card.unverifiedBadgeTitle.toLowerCase();
    expect(title).toMatch(/se mantiene|se conserva|sigue en la lista/);
    expect(title).toMatch(/no hay prueba|no es prueba|sin prueba/);
  });

  it('is written in Spanish, like the rest of the interface', () => {
    expect(isSpanishSentence(ES.card.unverifiedBadgeTitle)).toBe(true);
  });

  it('does not reuse the sample-data wording, which means something else entirely', () => {
    // "Ejemplo" means the posting is invented. "Sin verificar" means it is real
    // and we could not reach it. Collapsing them would be a lie in both
    // directions.
    expect(ES.card.unverifiedBadge).not.toBe(ES.card.sampleBadge);
    expect(ES.card.unverifiedBadgeTitle).not.toBe(ES.card.sampleBadgeTitle);
  });
});

describe('source provenance copy', () => {
  it('has Spanish labels for every known source id and a fallback for unknown ones', () => {
    for (const id of ['arbeitnow', 'ashby', 'fixture', 'greenhouse', 'landingjobs', 'lever', 'manfred', 'smartrecruiters']) {
      expect(ES.source.labels[id]).toBeTruthy();
    }
    expect(ES.source.unknown('abc')).toContain('abc');
    expect(ES.source.unknown('')).not.toContain('()');
    expect(ES.queue.sourceOption('Lever', 3)).toBe('Lever (3)');
  });
});
