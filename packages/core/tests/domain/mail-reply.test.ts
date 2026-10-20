import { describe, expect, it } from 'vitest';
import { classifyReply } from '../../src/domain/mail-reply.js';

const outcome = (subject: string, snippet = ''): string | null =>
  classifyReply({ subject, snippet })?.outcome ?? null;

describe('classifyReply', () => {
  it.each([
    ['Tu candidatura en Nubesol', 'Lamentamos comunicarte que no continuaremos con tu candidatura.'],
    ['Proceso Zafiro', 'Hemos decidido seguir con otros candidatos.'],
    ['Update on your application', 'Unfortunately we cannot offer you a place.'],
    ['Your application', 'We regret to inform you that the role was filled.'],
    ['Application status', 'We are not moving forward with your profile.'],
  ])('detects a rejection: %s', (subject, snippet) => {
    expect(outcome(subject, snippet)).toBe('rejected');
  });

  it.each([
    ['Entrevista con Nubesol', ''],
    ['Siguiente paso', 'Te invitamos a una entrevista el jueves.'],
    ['Next steps', 'Please reply to schedule an interview with our team.'],
    ['Hablamos', 'Te proponemos una llamada el lunes.'],
  ])('detects an interview: %s', (subject, snippet) => {
    expect(outcome(subject, snippet)).toBe('interview');
  });

  it.each([
    ['Good news', 'We are pleased to send you a job offer.'],
    ['Buenas noticias', 'Nos gustaría ofrecerte el puesto.'],
  ])('detects an offer: %s', (subject, snippet) => {
    expect(outcome(subject, snippet)).toBe('offer');
  });

  it.each([
    ['Preselección', 'Has sido preseleccionado para la siguiente fase.'],
    ['Good news', 'You have been shortlisted and move to the next stage.'],
  ])('detects screening: %s', (subject, snippet) => {
    expect(outcome(subject, snippet)).toBe('screening');
  });

  it('returns the matched evidence terms', () => {
    const result = classifyReply({ subject: 'Entrevista', snippet: 'Te invitamos a una entrevista.' });
    expect(result?.evidence.length).toBeGreaterThan(0);
    expect(result?.evidence).toContain('entrevista');
  });

  it('treats a pure acknowledgement of receipt as no signal', () => {
    expect(
      classifyReply({
        subject: 'Candidatura recibida',
        snippet: 'Hemos recibido tu candidatura y la estamos revisando. Gracias.',
      }),
    ).toBeNull();
    expect(
      classifyReply({ subject: 'Thanks', snippet: 'We have received your application and are reviewing it.' }),
    ).toBeNull();
  });

  it('never decides on ambiguous bare words', () => {
    expect(classifyReply({ subject: 'Oferta', snippet: '' })).toBeNull();
    expect(classifyReply({ subject: 'Gracias', snippet: 'Gracias por todo' })).toBeNull();
    expect(classifyReply({ subject: 'Candidatura', snippet: '' })).toBeNull();
    expect(classifyReply({ subject: 'Nuevas ofertas para ti', snippet: 'oferta del día' })).toBeNull();
  });

  it('does not mistake job-alert or missed-call mails for a reply', () => {
    // Job alerts (CU2) and call notices reuse these exact phrases.
    expect(classifyReply({ subject: 'Nueva oferta de trabajo para ti', snippet: 'Acme Software busca desarrollador junior en Madrid' })).toBeNull();
    expect(classifyReply({ subject: 'Oferta laboral', snippet: 'Empleos que coinciden con tu perfil en Acme' })).toBeNull();
    expect(classifyReply({ subject: 'New job offer alert', snippet: 'Jobs matching your profile at Acme' })).toBeNull();
    expect(classifyReply({ subject: 'Llamada perdida', snippet: 'Tienes una llamada perdida de tu proveedor' })).toBeNull();
    expect(classifyReply({ subject: 'Oferta de trabajo', snippet: '' })).toBeNull();
  });

  it('still reads a recruiter proposing a call as an interview', () => {
    expect(outcome('Hablamos', 'Te proponemos una llamada el lunes.')).toBe('interview');
    expect(outcome('Siguiente paso', 'Podemos agendar una llamada contigo esta semana.')).toBe('interview');
  });

  it('returns null when rejection and positive signals conflict', () => {
    expect(outcome('Entrevista', 'Lamentablemente no continuaremos con tu candidatura.')).toBeNull();
    expect(outcome('Offer', 'We would like to offer you the role. Unfortunately it was withdrawn.')).toBeNull();
  });

  it('returns null when two different positive outcomes compete', () => {
    expect(outcome('Entrevista', 'Tras la entrevista, nos gustaría ofrecerte el puesto.')).toBeNull();
  });

  it('prefers the stronger of screening and interview', () => {
    expect(outcome('Preselección', 'Has sido preseleccionado: te invitamos a una entrevista.')).toBe(
      'interview',
    );
  });

  it('is accent- and case-insensitive', () => {
    expect(outcome('ENTREVISTA', '')).toBe('interview');
    expect(outcome('entrevista', '')).toBe('interview');
    expect(outcome('x', 'NOS GUSTARIA OFRECERTE el puesto')).toBe('offer');
    expect(outcome('x', 'Lamentamos informarte: NO CONTINUAREMOS con tu candidatura')).toBe('rejected');
  });

  it('matches whole tokens only', () => {
    expect(outcome('Entrevistadora', '')).toBeNull();
    expect(outcome('Interviewing tips', 'weekly newsletter')).toBeNull();
  });

  it('returns null for empty or unrelated mail', () => {
    expect(classifyReply({ subject: '', snippet: '' })).toBeNull();
    expect(classifyReply({ subject: 'Factura de enero', snippet: 'Adjuntamos tu factura.' })).toBeNull();
  });
});
