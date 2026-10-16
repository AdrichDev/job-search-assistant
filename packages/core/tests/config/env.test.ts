import { describe, expect, it } from 'vitest';
import { loadDotEnv } from '../../src/config/env.js';

describe('loadDotEnv', () => {
  it('is a no-op when the file does not exist', () => {
    expect(() => loadDotEnv('definitely-not-here.env')).not.toThrow();
  });
});
