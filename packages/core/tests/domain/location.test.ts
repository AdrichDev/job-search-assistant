import { describe, expect, it } from 'vitest';
import { scoreLocation } from '../../src/domain/scoring/location.js';
import { normalizeText } from '../../src/domain/text.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';

const config = DEFAULT_SCORING_CONFIG.location;

function run(location: string, body = '', englishOnly = false) {
  return scoreLocation(
    {
      normalizedLocation: normalizeText(location),
      normalizedText: normalizeText(`${location} ${body}`),
      englishOnly,
    },
    config,
  );
}

describe('scoreLocation', () => {
  it('gives the top score to Madrid', () => {
    expect(run('Madrid, Comunidad de Madrid').value).toBe(config.scores.primary);
  });

  it('gives a near-top score to the Madrid metro area', () => {
    expect(run('Alcobendas, Madrid').value).toBe(config.scores.primary);
    expect(run('Getafe').value).toBe(config.scores.metro);
  });

  it('scores hybrid Madrid as Madrid', () => {
    expect(run('Madrid', 'Modelo híbrido, 3 días en oficina').value).toBe(config.scores.primary);
  });

  it('scores remote-Spain highly', () => {
    expect(run('España', 'Trabajo 100% en remoto desde España').value).toBe(
      config.scores.remoteSpain,
    );
  });

  it('penalizes an English-first remote-global role', () => {
    const result = run('Remote', 'We are a remote first team looking for you', true);
    expect(result.value).toBe(config.scores.remoteGlobalEnglish);
  });

  it('gives a middling score to remote roles with no country stated', () => {
    expect(run('Remoto', 'Puesto en remoto').value).toBe(config.scores.remoteUnspecified);
  });

  it('down-ranks other Spanish cities', () => {
    expect(run('Barcelona').value).toBe(config.scores.otherSpanishCity);
    expect(run('Valencia').value).toBe(config.scores.otherSpanishCity);
  });

  it('prefers Madrid over Barcelona when both are mentioned', () => {
    expect(run('Madrid').value).toBeGreaterThan(run('Barcelona').value);
  });

  it('falls back to a neutral score for an unknown location', () => {
    expect(run('').value).toBe(config.scores.unknown);
  });

  it('explains itself', () => {
    expect(run('Madrid').reason.toLowerCase()).toContain('madrid');
  });
});
