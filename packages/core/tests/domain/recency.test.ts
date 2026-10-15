import { describe, expect, it } from 'vitest';
import { scoreRecency } from '../../src/domain/scoring/recency.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { REFERENCE_NOW, daysAgo } from '../helpers/make-job.js';

const config = DEFAULT_SCORING_CONFIG.recency;

function run(days: number) {
  return scoreRecency(daysAgo(days), REFERENCE_NOW, config);
}

describe('scoreRecency', () => {
  it('gives full marks to a posting published today', () => {
    expect(run(0).value).toBe(1);
  });

  it('decays linearly across the configured window', () => {
    expect(run(15).value).toBeCloseTo(0.5, 5);
  });

  it('reaches the floor at the end of the window', () => {
    expect(run(config.decayDays).value).toBe(config.floor);
  });

  it('does not go below the floor for very old postings', () => {
    expect(run(365).value).toBe(config.floor);
  });

  it('treats a future-dated posting as brand new', () => {
    expect(scoreRecency(new Date(REFERENCE_NOW.getTime() + 86_400_000), REFERENCE_NOW, config).value).toBe(1);
  });

  it('ranks a newer posting above an older one', () => {
    expect(run(2).value).toBeGreaterThan(run(20).value);
  });

  it('explains itself with the age in days', () => {
    expect(run(4).reason).toContain('4');
  });
});
