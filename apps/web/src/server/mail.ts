import 'server-only';

import { createGmailReader } from '@job-queue/core';
import type { GmailFetchResult, GmailReader, MailUnavailableReason } from '@job-queue/core';

/**
 * Composition point for Gmail. This is the ONLY module allowed to read the
 * `GOOGLE_*` variables or `JOB_QUEUE_WEB_MAIL`, and it exports no function that
 * returns a credential value: callers get a flag and a reader, nothing else.
 *
 * `process.env` only, never a file: a blank value counts as absent, exactly as
 * `readEnv` in `server/pipeline.ts`.
 */

type Env = Readonly<Record<string, string | undefined>>;

const GOOGLE_VARIABLES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;

function readEnv(env: Env, name: string): string | undefined {
  const raw = env[name];
  return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim();
}

function isFake(env: Env): boolean {
  return readEnv(env, 'JOB_QUEUE_WEB_MAIL') === 'fake';
}

function hasGoogleCredentials(env: Env): boolean {
  return GOOGLE_VARIABLES.every((name) => readEnv(env, name) !== undefined);
}

/** True when mail can run: the e2e fake, or all three Google variables present. */
export function mailConfigured(env: Env = process.env): boolean {
  return isFake(env) || hasGoogleCredentials(env);
}

const UNAVAILABLE: GmailFetchResult = { status: 'unavailable', reason: 'bad_response' };

/** Reader that never touches anything. Callers must check `mailConfigured()` first. */
const notConfiguredReader: GmailReader = {
  fetchRecent: async () => UNAVAILABLE,
};

const FAKE_UNAVAILABLE: readonly MailUnavailableReason[] = [
  'network',
  'rate_limited',
  'server',
  'bad_response',
];

/** Deterministic fake used by tests and e2e. Never reaches the network. */
function createFakeReader(mode: string | undefined): GmailReader {
  return {
    fetchRecent: async () => {
      if (mode === 'auth_expired') {
        return { status: 'auth_expired' };
      }
      if (mode === 'throw') {
        throw new Error('Fake mail reader failure');
      }
      const reason = FAKE_UNAVAILABLE.find((candidate) => candidate === mode);
      if (reason !== undefined) {
        return { status: 'unavailable', reason };
      }
      return { status: 'ok', messages: [] };
    },
  };
}

function createReader(env: Env): GmailReader {
  if (isFake(env)) {
    return createFakeReader(readEnv(env, 'JOB_QUEUE_WEB_MAIL_FAKE'));
  }
  if (hasGoogleCredentials(env)) {
    // U6: this branch is now the REAL raw-fetch Gmail adapter, built from the
    // three GOOGLE_* variables. The refresh-token exchange and every Gmail call
    // live in `packages/core/src/adapters/gmail/gmail-reader.ts`; expected
    // failures come back as values (`auth_expired`, `unavailable`), never as
    // thrown errors. No credential is exposed here: callers get a reader and a
    // flag, nothing else.
    return createGmailReader({
      clientId: readEnv(env, 'GOOGLE_CLIENT_ID')!,
      clientSecret: readEnv(env, 'GOOGLE_CLIENT_SECRET')!,
      refreshToken: readEnv(env, 'GOOGLE_REFRESH_TOKEN')!,
    });
  }
  return notConfiguredReader;
}

let cached: GmailReader | null = null;

/**
 * Process singleton for the real environment. An injected `env` (tests) builds a
 * fresh reader and never touches the singleton.
 */
export function gmailReader(env?: Env): GmailReader {
  if (env !== undefined) {
    return createReader(env);
  }
  cached ??= createReader(process.env);
  return cached;
}
