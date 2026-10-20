import { containsTerm, normalizeText } from './text.js';

/**
 * Reads a company reply (subject + snippet only, never a body) and says which
 * outcome it clearly announces, or nothing.
 *
 * Deliberately conservative: a wrong proposal costs the user attention, a missed
 * one costs nothing because they can still edit by hand. So:
 *
 * - Only specific phrases count. Bare words such as `oferta`, `candidatura` or
 *   `gracias` never decide, and a pure acknowledgement of receipt ("hemos
 *   recibido tu candidatura y la estamos revisando") matches no phrase at all.
 * - A rejection together with any positive signal is a conflict: `null`.
 * - Two different positive outcomes compete -> `null`, except that `screening`
 *   is subsumed by `interview` or `offer` (a later stage implies the earlier).
 *
 * Terms are matched on normalized text (accent- and case-insensitive) with token
 * boundaries, so `entrevistadora` is not `entrevista`.
 */

export type ReplyOutcome = 'rejected' | 'screening' | 'interview' | 'offer';

export interface ReplyInput {
  readonly subject: string;
  readonly snippet: string;
}

export interface ReplyClassification {
  readonly outcome: ReplyOutcome;
  readonly evidence: readonly string[];
}

const TERMS: Readonly<Record<ReplyOutcome, readonly string[]>> = {
  rejected: [
    'no continuaremos',
    'no seguiremos con',
    'no avanzaremos',
    'seguir con otros candidatos',
    'continuar con otros candidatos',
    'otros perfiles que se ajustan',
    'lamentamos informarte',
    'lamentablemente',
    'desafortunadamente',
    'unfortunately',
    'we regret to inform',
    'not moving forward',
    'not be moving forward',
    'decided not to proceed',
    'will not be proceeding',
  ],
  screening: [
    'preseleccionado',
    'preseleccionada',
    'preseleccion',
    'siguiente fase',
    'siguiente etapa',
    'shortlisted',
    'next stage',
    'next round',
    'prueba tecnica',
    'technical test',
    'coding challenge',
  ],
  interview: [
    'entrevista',
    'entrevistarte',
    'videollamada',
    // A bare `llamada` is also a missed-call notice, so only a proposal counts.
    'proponemos una llamada',
    'agendar una llamada',
    'programar una llamada',
    'concertar una llamada',
    'interview',
    'schedule a call',
    'phone screen',
  ],
  // `oferta de trabajo`, `oferta laboral` and `job offer` are NOT here: job-alert
  // mails (CU2) are made of those phrases. Only wording addressed to the person counts.
  offer: [
    'nos gustaria ofrecerte',
    'ofrecerte el puesto',
    'send you a job offer',
    'send you an offer',
    'offer of employment',
    'pleased to offer',
    'would like to offer you',
  ],
};

function evidenceFor(haystack: string, outcome: ReplyOutcome): string[] {
  return TERMS[outcome].filter((term) => containsTerm(haystack, term)).map((term) => normalizeText(term));
}

export function classifyReply(input: ReplyInput): ReplyClassification | null {
  const haystack = normalizeText(`${input.subject} ${input.snippet}`);
  if (haystack.length === 0) {
    return null;
  }

  const rejected = evidenceFor(haystack, 'rejected');
  const screening = evidenceFor(haystack, 'screening');
  const interview = evidenceFor(haystack, 'interview');
  const offer = evidenceFor(haystack, 'offer');

  const positive = screening.length > 0 || interview.length > 0 || offer.length > 0;
  if (rejected.length > 0) {
    return positive ? null : { outcome: 'rejected', evidence: rejected };
  }

  if (interview.length > 0 && offer.length > 0) {
    return null;
  }
  if (offer.length > 0) {
    return { outcome: 'offer', evidence: offer };
  }
  if (interview.length > 0) {
    return { outcome: 'interview', evidence: interview };
  }
  if (screening.length > 0) {
    return { outcome: 'screening', evidence: screening };
  }
  return null;
}
