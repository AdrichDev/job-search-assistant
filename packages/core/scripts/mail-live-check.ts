import { loadDotEnv } from '../src/config/env.js';
import { consoleLogger } from '../src/adapters/logging/console-logger.js';
import { createGmailReader } from '../src/adapters/gmail/gmail-reader.js';

/**
 * The REAL verification for the Gmail adapter (U6). No mocks, no fakes: this
 * script builds the real reader, calls Google, and reads the human's actual
 * mailbox for the last 7 days.
 *
 *   cd packages/core && npm run mail:live
 *
 * Deliberately quiet about personal data. It prints the result status, the
 * message count and the DEDUPLICATED SENDER DOMAINS - never subjects,
 * snippets, message ids or bodies, and never any credential.
 *
 * This is a SCRIPT and not a test on purpose: it hits the network, so it must
 * never run inside `npm test`.
 */

const DAYS = 7;
const MAX_RESULTS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const UNAVAILABLE_HINTS: Record<string, string> = {
  network: 'check your internet connection and try again',
  rate_limited: 'Google is rate-limiting this account; wait and try again later',
  server: 'Google reported a server error; try again later',
  bad_response:
    'unexpected response from Google; verify the OAuth client exists and the Gmail API is enabled for the project',
};

function googleValue(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim();
}

function senderDomain(from: string): string | undefined {
  const domain = from.split('@')[1]?.trim().toLowerCase();
  return domain === undefined || domain.length === 0 ? undefined : domain;
}

async function main(): Promise<number> {
  loadDotEnv();

  const clientId = googleValue('GOOGLE_CLIENT_ID');
  const clientSecret = googleValue('GOOGLE_CLIENT_SECRET');
  const refreshToken = googleValue('GOOGLE_REFRESH_TOKEN');
  if (clientId === undefined || clientSecret === undefined || refreshToken === undefined) {
    consoleLogger.error(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN must be set; ' +
        'run `npm run google:consent` first if the token is missing.',
    );
    return 1;
  }

  const reader = createGmailReader({ clientId, clientSecret, refreshToken });
  const since = new Date(Date.now() - DAYS * DAY_MS);
  const result = await reader.fetchRecent({ since, maxResults: MAX_RESULTS });

  if (result.status === 'auth_expired') {
    consoleLogger.error(
      'auth_expired: the Google refresh token has expired (invalid_grant); ' +
        'run `npm run google:consent` and try again.',
    );
    return 1;
  }
  if (result.status === 'unavailable') {
    consoleLogger.error(
      `unavailable (${result.reason}): ${UNAVAILABLE_HINTS[result.reason] ?? 'try again later'}`,
    );
    return 1;
  }

  const domains = new Set<string>();
  for (const message of result.messages) {
    const domain = senderDomain(message.from);
    if (domain !== undefined) {
      domains.add(domain);
    }
  }

  consoleLogger.info(`status: ok`);
  consoleLogger.info(`messages in the last ${DAYS} days: ${result.messages.length}`);
  consoleLogger.info(
    `sender domains: ${domains.size > 0 ? [...domains].sort().join(', ') : '(none)'}`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    consoleLogger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
