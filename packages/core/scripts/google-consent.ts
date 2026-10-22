import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadDotEnv, DEFAULT_DOTENV_PATH } from '../src/config/env.js';
import { consoleLogger } from '../src/adapters/logging/console-logger.js';

/**
 * One-time OAuth consent for the real Gmail reader (U8). THE HUMAN runs this:
 *
 *   cd packages/core && npm run google:consent
 *
 * What it does, in order:
 *
 *   1. Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the repo-root
 *      `.env` (the same file every workspace shares).
 *   2. Starts a throwaway HTTP server on an ephemeral 127.0.0.1 port.
 *   3. Prints the Google consent URL. The human opens it in a browser and
 *      approves the read-only Gmail scope.
 *   4. Google redirects to the loopback port with `code` and `state`. The
 *      `state` is verified against the random value generated here.
 *   5. The code is exchanged for a refresh token, which is appended to
 *      `.env` as GOOGLE_REFRESH_TOKEN - but ONLY if that key is not already
 *      present. If it is present, nothing is written.
 *
 * The refresh token and the client secret are NEVER printed. The only output
 * about the write is that it happened and where. No dependency beyond Node
 * built-ins, because this runs exactly once on the developer's machine and
 * should be readable in one sitting before being trusted with it.
 *
 * This is a SCRIPT and not a test on purpose: it talks to Google.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const REQUEST_TIMEOUT_MS = 15_000;

const COMPLETE_PAGE =
  '<html><body><p>Consent complete. You can close this tab and return to the terminal.</p></body></html>';

function googleValue(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim();
}

function writeResponse(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function envHasKey(path: string, key: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  return new RegExp(`^${key}=`, 'm').test(readFileSync(path, 'utf8'));
}

function appendEnvKey(path: string, key: string, value: string): void {
  // Keep the file's line structure intact: only add a leading newline when the
  // existing file does not already end with one.
  const prefix =
    existsSync(path) && !readFileSync(path, 'utf8').endsWith('\n') ? '\n' : '';
  appendFileSync(path, `${prefix}${key}=${value}\n`, 'utf8');
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<{ ok: true; refreshToken: string } | { ok: false; message: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, message: 'could not reach Google to exchange the code (network error)' };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `Google rejected the code exchange (HTTP ${response.status}); run this script again`,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    return { ok: false, message: 'Google answered with something that is not JSON' };
  }

  const refreshToken =
    typeof payload === 'object' && payload !== null && 'refresh_token' in payload
      ? (payload as { refresh_token: unknown }).refresh_token
      : undefined;

  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return {
      ok: false,
      message:
        'Google did not return a refresh token; make sure the OAuth client is a "Desktop app" and re-run consent',
    };
  }
  return { ok: true, refreshToken };
}

async function main(): Promise<number> {
  loadDotEnv();

  const clientId = googleValue('GOOGLE_CLIENT_ID');
  const clientSecret = googleValue('GOOGLE_CLIENT_SECRET');
  if (clientId === undefined || clientSecret === undefined) {
    consoleLogger.error(
      `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in ${DEFAULT_DOTENV_PATH} first.`,
    );
    return 1;
  }

  const state = randomBytes(16).toString('hex');

  // Port 0 lets the OS pick. Google accepts ANY loopback port for a Desktop-type
  // OAuth client, but a Web-application client only accepts the exact URIs that
  // were registered, so GOOGLE_CONSENT_PORT pins one for that case.
  const requestedPort = Number(process.env.GOOGLE_CONSENT_PORT ?? '0');
  const server = createServer();
  await new Promise<void>((resolveListen) => {
    server.listen(Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : 0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    consoleLogger.error('could not bind a loopback port.');
    return 1;
  }
  const redirectUri = `http://127.0.0.1:${address.port}/`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  consoleLogger.info(`Open this URL in a browser and approve the Gmail read-only scope:\n`);
  consoleLogger.info(`${AUTH_URL}?${params}\n`);

  const outcome = await new Promise<{ code: string } | { error: string }>((resolve) => {
    const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
      const query = new URL(request.url ?? '/', redirectUri).searchParams;

      const googleError = query.get('error');
      if (googleError !== null) {
        const description = query.get('error_description');
        writeResponse(response, 200, '<html><body><p>Consent was denied. You can close this tab.</p></body></html>');
        server.close();
        const detail = description === null ? '' : `: ${description}`;
        const hint =
          googleError === 'redirect_uri_mismatch'
            ? ` The redirect URI used was ${redirectUri} and it is not registered on this client. ` +
              'Either switch the OAuth client to type "Desktop", or register that exact URI and pin the port with GOOGLE_CONSENT_PORT.'
            : googleError === 'access_denied'
              ? ' If the page said the app is not verified, add your Google account as a Test user on the OAuth consent screen (External, testing).'
              : '';
        resolve({ error: `consent was denied by Google (${googleError}${detail}).${hint}` });
        return;
      }

      if (query.get('state') !== state) {
        // Not our redirect (or a forged one). Do not close: the real redirect
        // may still arrive.
        writeResponse(response, 400, '<html><body><p>State mismatch.</p></body></html>');
        return;
      }

      const code = query.get('code');
      if (code === null || code.length === 0) {
        writeResponse(response, 400, '<html><body><p>Missing code.</p></body></html>');
        return;
      }

      writeResponse(response, 200, COMPLETE_PAGE);
      server.close();
      resolve({ code });
    };
    server.on('request', onRequest);
  });

  if ('error' in outcome) {
    consoleLogger.error(outcome.error);
    return 1;
  }

  const exchanged = await exchangeCode(outcome.code, redirectUri, clientId, clientSecret);
  if (!exchanged.ok) {
    consoleLogger.error(exchanged.message);
    return 1;
  }

  if (envHasKey(DEFAULT_DOTENV_PATH, 'GOOGLE_REFRESH_TOKEN')) {
    consoleLogger.info(
      `GOOGLE_REFRESH_TOKEN is already present in ${DEFAULT_DOTENV_PATH}; nothing was changed.`,
    );
    return 0;
  }

  appendEnvKey(DEFAULT_DOTENV_PATH, 'GOOGLE_REFRESH_TOKEN', exchanged.refreshToken);
  consoleLogger.info(`GOOGLE_REFRESH_TOKEN written to ${DEFAULT_DOTENV_PATH}.`);
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
