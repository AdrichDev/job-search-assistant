/**
 * The real Gmail read-only adapter: raw `fetch` against Google's OAuth2 and
 * Gmail v1 REST endpoints. No SDK, no retry loop, no caching of anything but
 * the access token for one `fetchRecent` call.
 *
 * Design rules this file is held to (see `ports/gmail-reader.ts`):
 *
 *   1. Expected failures are VALUES, never exceptions. Every HTTP status,
 *      JSON problem and thrown `fetch` is mapped onto `GmailFetchResult`.
 *   2. Nothing personal beyond the port crosses this adapter: no body, no
 *      attachments, no label dump - `format=metadata` with exactly the two
 *      headers the port's `MailMessage` needs.
 *   3. A credential (access token, client secret, refresh token) is never
 *      logged, embedded in an Error message, or returned. Errors here are
 *      reasons, not text.
 *   4. Bounded timeouts; one attempt. A hanging Google endpoint cannot stall
 *      the caller, and a 429 is reported, not hammered.
 */

import type {
  GmailFetchResult,
  GmailQuery,
  GmailReader,
  MailMessage,
  MailUnavailableReason,
} from '../../ports/gmail-reader.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_PAGE_SIZE = 500;

/** How many metadata fetches run at once: polite, and still far quicker than one by one. */
const FETCH_CONCURRENCY = 8;

const MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

/**
 * Bounded on purpose. Generous enough for a cold Gmail response, short enough
 * that a hung connection turns into `network` instead of a stalled run.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Anything a request can come back as instead of the data we wanted. */
type Failure =
  | { readonly status: 'auth_expired' }
  | { readonly status: 'unavailable'; readonly reason: MailUnavailableReason };

export interface CreateGmailReaderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** Injectable for callers that need to route the request; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

function reasonForHttp(status: number): MailUnavailableReason {
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'server';
  }
  return 'bad_response';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Refresh-token exchange. Google answers `invalid_grant` when the refresh
 * token has expired (7 days in testing mode) or was revoked: that is the
 * `auth_expired` value, the one signal the human can act on by re-running
 * consent. The response body is inspected for the error string but is never
 * surfaced anywhere.
 */
async function refreshAccessToken(
  doFetch: typeof fetch,
  config: CreateGmailReaderConfig,
): Promise<{ readonly token: string } | Failure> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });

  let response: Response;
  try {
    response = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 'unavailable', reason: 'network' };
  }

  if (!response.ok) {
    if (response.status === 400) {
      if ((await readBody(response)).includes('invalid_grant')) {
        return { status: 'auth_expired' };
      }
    }
    return { status: 'unavailable', reason: reasonForHttp(response.status) };
  }

  const payload = asRecord(parseJson(await readBody(response)));
  const token = asString(payload?.['access_token']);
  if (token === undefined || token.length === 0) {
    return { status: 'unavailable', reason: 'bad_response' };
  }
  return { token };
}

/**
 * Every id in the window, following `nextPageToken` to the end.
 *
 * Gmail caps one page at 500 ids, so a caller asking for more than that needs
 * pagination or it silently receives a truncated week. `query.maxResults` stays
 * the caller's ceiling: this stops at whichever comes first, the cap or the last
 * page. A mailbox with no matches answers WITHOUT a `messages` key at all -
 * absence is an empty result, not a shape mismatch.
 */
async function listMessageIds(
  doFetch: typeof fetch,
  accessToken: string,
  query: GmailQuery,
): Promise<{ readonly ids: readonly string[] } | Failure> {
  const epochSeconds = Math.floor(query.since.getTime() / 1000);
  const ids: string[] = [];
  let pageToken: string | undefined;

  for (;;) {
    const remaining = query.maxResults - ids.length;
    if (remaining <= 0) {
      return { ids };
    }

    const params = new URLSearchParams({
      q: `after:${epochSeconds}`,
      maxResults: String(Math.min(GMAIL_PAGE_SIZE, remaining)),
    });
    if (pageToken !== undefined) {
      params.set('pageToken', pageToken);
    }

    let response: Response;
    try {
      response = await doFetch(`${MESSAGES_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { status: 'unavailable', reason: 'network' };
    }

    if (!response.ok) {
      return { status: 'unavailable', reason: reasonForHttp(response.status) };
    }

    const payload = asRecord(parseJson(await readBody(response)));
    if (payload === undefined) {
      return { status: 'unavailable', reason: 'bad_response' };
    }

    const entries = payload['messages'];
    if (entries !== undefined && !Array.isArray(entries)) {
      return { status: 'unavailable', reason: 'bad_response' };
    }

    for (const entry of entries ?? []) {
      const id = asString(asRecord(entry)?.['id']);
      if (id === undefined || id.length === 0) {
        return { status: 'unavailable', reason: 'bad_response' };
      }
      ids.push(id);
    }

    const next = asString(payload['nextPageToken']);
    if (next === undefined || next.length === 0) {
      return { ids };
    }
    pageToken = next;
  }
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!Array.isArray(headers)) {
    return undefined;
  }
  for (const entry of headers) {
    const record = asRecord(entry);
    if (asString(record?.['name'])?.toLowerCase() === name.toLowerCase()) {
      const value = asString(record?.['value']);
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * `From` headers arrive as `"Display Name" <user@domain>` or a bare address.
 * The port wants the ADDRESS ONLY, so the display name is discarded here and
 * never leaves the adapter.
 */
function senderAddress(fromHeader: string): string {
  const angled = /<([^>]+)>/.exec(fromHeader);
  return (angled?.[1] ?? fromHeader).trim();
}

/**
 * Builds the port's `MailMessage` from a `format=metadata` message resource,
 * or `undefined` when the shape is not what the Gmail API documents (which
 * maps to `bad_response` upstream).
 *
 * `internalDate` and `snippet` are top-level fields of the message resource
 * and are expected to be present in `metadata` format. If Google stops
 * returning one of them, this adapter reports `bad_response` rather than
 * guessing - the live check (`mail:live`) is where such a drift shows up.
 */
function parseMessage(payload: unknown): MailMessage | undefined {
  const record = asRecord(payload);
  if (record === undefined) {
    return undefined;
  }

  const id = asString(record['id']);
  const threadId = asString(record['threadId']);
  const internalDate = asString(record['internalDate']);
  const snippet = asString(record['snippet']);
  const from = headerValue(asRecord(record['payload'])?.['headers'], 'From');
  const subject = headerValue(asRecord(record['payload'])?.['headers'], 'Subject') ?? '';

  if (
    id === undefined ||
    id.length === 0 ||
    threadId === undefined ||
    internalDate === undefined ||
    snippet === undefined ||
    from === undefined
  ) {
    return undefined;
  }

  const milliseconds = Number(internalDate);
  if (!Number.isFinite(milliseconds)) {
    return undefined;
  }

  return {
    id,
    threadId,
    receivedAt: new Date(milliseconds),
    from: senderAddress(from),
    subject,
    snippet,
  };
}

async function fetchMessage(
  doFetch: typeof fetch,
  accessToken: string,
  id: string,
): Promise<{ readonly message: MailMessage } | Failure> {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const header of ['From', 'Subject']) {
    params.append('metadataHeaders', header);
  }

  let response: Response;
  try {
    response = await doFetch(`${MESSAGES_URL}/${encodeURIComponent(id)}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 'unavailable', reason: 'network' };
  }

  if (!response.ok) {
    return { status: 'unavailable', reason: reasonForHttp(response.status) };
  }

  const message = parseMessage(parseJson(await readBody(response)));
  return message === undefined
    ? { status: 'unavailable', reason: 'bad_response' }
    : { message };
}

/**
 * The real `GmailReader`. One access token is fetched per call and used for
 * the list plus its metadata fetches; it is kept in a local, never stored or
 * logged. Message fetches run sequentially: this is a low-frequency mail
 * check, and politeness plus a simple total error map beat concurrency here.
 */
export function createGmailReader(config: CreateGmailReaderConfig): GmailReader {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    async fetchRecent(query: GmailQuery): Promise<GmailFetchResult> {
      const refreshed = await refreshAccessToken(doFetch, config);
      if (!('token' in refreshed)) {
        return refreshed;
      }

      const listed = await listMessageIds(doFetch, refreshed.token, query);
      if (!('ids' in listed)) {
        return listed;
      }

      const messages: MailMessage[] = [];
      for (let index = 0; index < listed.ids.length; index += FETCH_CONCURRENCY) {
        const chunk = listed.ids.slice(index, index + FETCH_CONCURRENCY);
        const settled = await Promise.all(chunk.map((id) => fetchMessage(doFetch, refreshed.token, id)));
        for (const fetched of settled) {
          if (!('message' in fetched)) {
            return fetched;
          }
          messages.push(fetched.message);
        }
      }

      return { status: 'ok', messages };
    },
  };
}
