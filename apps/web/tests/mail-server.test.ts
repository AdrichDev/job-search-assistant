import { describe, expect, it } from 'vitest';
import * as mailModule from '@/server/mail';
import { gmailReader, mailConfigured } from '@/server/mail';

const ID = 'client-id-VALUE-1111';
const SECRET = 'client-secret-VALUE-2222';
const TOKEN = 'refresh-token-VALUE-3333';
const QUERY = { since: new Date('2026-03-01T00:00:00Z'), maxResults: 10 };

const FULL = {
  GOOGLE_CLIENT_ID: ID,
  GOOGLE_CLIENT_SECRET: SECRET,
  GOOGLE_REFRESH_TOKEN: TOKEN,
};

describe('mailConfigured', () => {
  it('is false with no variables', () => {
    expect(mailConfigured({})).toBe(false);
  });

  it('is false when only some GOOGLE_* variables exist', () => {
    expect(mailConfigured({ GOOGLE_CLIENT_ID: ID })).toBe(false);
    expect(mailConfigured({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SECRET })).toBe(false);
  });

  it('is true with all three', () => {
    expect(mailConfigured(FULL)).toBe(true);
  });

  it('counts a blank value as absent', () => {
    expect(mailConfigured({ ...FULL, GOOGLE_REFRESH_TOKEN: '   ' })).toBe(false);
    expect(mailConfigured({ JOB_QUEUE_WEB_MAIL: '  ' })).toBe(false);
  });

  it('is true for the fake switch alone', () => {
    expect(mailConfigured({ JOB_QUEUE_WEB_MAIL: 'fake' })).toBe(true);
  });

  it('ignores other values of the switch', () => {
    expect(mailConfigured({ JOB_QUEUE_WEB_MAIL: 'real' })).toBe(false);
  });
});

describe('gmailReader', () => {
  it('unconfigured: unavailable bad_response', async () => {
    expect(await gmailReader({}).fetchRecent(QUERY)).toEqual({
      status: 'unavailable',
      reason: 'bad_response',
    });
  });


  it('fake returns empty ok by default', async () => {
    expect(await gmailReader({ JOB_QUEUE_WEB_MAIL: 'fake' }).fetchRecent(QUERY)).toEqual({
      status: 'ok',
      messages: [],
    });
  });

  it('fake wins over real credentials', async () => {
    const reader = gmailReader({ ...FULL, JOB_QUEUE_WEB_MAIL: 'fake' });
    expect(await reader.fetchRecent(QUERY)).toEqual({ status: 'ok', messages: [] });
  });

  it('each fake failure mode', async () => {
    const base = { JOB_QUEUE_WEB_MAIL: 'fake' };
    expect(await gmailReader({ ...base, JOB_QUEUE_WEB_MAIL_FAKE: 'auth_expired' }).fetchRecent(QUERY)).toEqual({
      status: 'auth_expired',
    });
    for (const reason of ['network', 'rate_limited', 'server', 'bad_response']) {
      expect(await gmailReader({ ...base, JOB_QUEUE_WEB_MAIL_FAKE: reason }).fetchRecent(QUERY)).toEqual({
        status: 'unavailable',
        reason,
      });
    }
    await expect(
      gmailReader({ ...base, JOB_QUEUE_WEB_MAIL_FAKE: 'throw' }).fetchRecent(QUERY),
    ).rejects.toThrow();
  });

  it('an unknown fake mode falls back to empty ok', async () => {
    const r = gmailReader({ JOB_QUEUE_WEB_MAIL: 'fake', JOB_QUEUE_WEB_MAIL_FAKE: 'whatever' });
    expect(await r.fetchRecent(QUERY)).toEqual({ status: 'ok', messages: [] });
  });

  it('is a singleton for the process environment', () => {
    expect(gmailReader()).toBe(gmailReader());
  });
});

describe('credential safety', () => {
  const values = [ID, SECRET, TOKEN];

  it('no result contains a credential value', async () => {
    const envs = [FULL, { ...FULL, JOB_QUEUE_WEB_MAIL: 'fake' }, { ...FULL, JOB_QUEUE_WEB_MAIL: 'fake', JOB_QUEUE_WEB_MAIL_FAKE: 'server' }];
    for (const env of envs) {
      const out = JSON.stringify([mailConfigured(env), await gmailReader(env).fetchRecent(QUERY)]);
      for (const v of values) expect(out).not.toContain(v);
    }
  });

  it('no exported function returns a credential value', () => {
    for (const [name, member] of Object.entries(mailModule)) {
      expect(typeof member, name).toBe('function');
      if (name === 'gmailReader' || name === 'mailConfigured') continue;
      throw new Error(`unexpected export ${name}`);
    }
    expect(Object.keys(mailModule).sort()).toEqual(['gmailReader', 'mailConfigured']);
    const reader = gmailReader(FULL) as unknown as Record<string, unknown>;
    expect(JSON.stringify(Object.keys(reader))).not.toMatch(/token|secret|client/i);
    for (const v of values) expect(JSON.stringify(reader)).not.toContain(v);
  });
});
