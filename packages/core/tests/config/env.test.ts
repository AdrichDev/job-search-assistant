import { describe, expect, it } from 'vitest';
import { loadAdzunaCredentials, loadDotEnv } from '../../src/config/env.js';

describe('loadAdzunaCredentials', () => {
  it('accepts a fully populated environment', () => {
    expect(
      loadAdzunaCredentials({ ADZUNA_APP_ID: 'abc', ADZUNA_APP_KEY: 'secret' }),
    ).toEqual({ appId: 'abc', appKey: 'secret' });
  });

  it('passes through an overridden base URL', () => {
    const credentials = loadAdzunaCredentials({
      ADZUNA_APP_ID: 'abc',
      ADZUNA_APP_KEY: 'secret',
      ADZUNA_BASE_URL: 'http://localhost:9999/v1/api/jobs/es/search',
    });
    expect(credentials.baseUrl).toBe('http://localhost:9999/v1/api/jobs/es/search');
  });

  it('omits the base URL entirely when it is not set', () => {
    expect('baseUrl' in loadAdzunaCredentials({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' })).toBe(false);
  });

  it('fails fast when credentials are missing, and points at the fixture mode', () => {
    expect(() => loadAdzunaCredentials({})).toThrow(/--source=fixture/);
  });

  it('names every offending variable', () => {
    expect(() => loadAdzunaCredentials({})).toThrow(/ADZUNA_APP_ID/);
    expect(() => loadAdzunaCredentials({ ADZUNA_APP_ID: 'a' })).toThrow(/ADZUNA_APP_KEY/);
  });

  it('rejects an empty string as a credential', () => {
    expect(() => loadAdzunaCredentials({ ADZUNA_APP_ID: '', ADZUNA_APP_KEY: 'b' })).toThrow(
      /ADZUNA_APP_ID/,
    );
  });

  it('rejects a malformed base URL', () => {
    expect(() =>
      loadAdzunaCredentials({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b', ADZUNA_BASE_URL: 'not-a-url' }),
    ).toThrow(/ADZUNA_BASE_URL/);
  });
});

describe('loadDotEnv', () => {
  it('is a no-op when the file does not exist', () => {
    expect(() => loadDotEnv('definitely-not-here.env')).not.toThrow();
  });
});
