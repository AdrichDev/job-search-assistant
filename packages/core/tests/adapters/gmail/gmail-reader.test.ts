import { describe, expect, it } from 'vitest';
import { createGmailReader } from '../../../src/adapters/gmail/gmail-reader.js';
import type { MailMessage } from '../../../src/ports/gmail-reader.js';

/**
 * The real Gmail adapter, tested against a fake `fetch`.
 *
 * Until this file existed the adapter had NO unit test: its behaviour was
 * verified only by the live run recorded in the ODD log, which pins nothing and
 * fails silently on the day Google changes a shape. The native review of the
 * commit that introduced it left exactly that as a warning, plus four about
 * pagination, and this file is the answer to them.
 *
 * The adapter takes an injectable `fetchImpl` on purpose, so no network, no
 * SDK and no module mocking is involved: every test here is a script of HTTP
 * answers and an assertion about what the adapter made of them.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

const QUERY = { since: new Date('2026-03-01T00:00:00.000Z'), maxResults: 100 };

function tokenAnswer(): Response {
  return jsonResponse({ access_token: 'access-token-1', expires_in: 3599 });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function messageResource(id: string): unknown {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: '1772323200000',
    snippet: `snippet ${id}`,
    payload: {
      headers: [
        { name: 'From', value: '"Nombre Apellido" <jobs@example.com>' },
        { name: 'Subject', value: 'Nuevas ofertas para ti' },
      ],
    },
  };
}

/** Every request the adapter made, in order, so a test can count them. */
interface Recorded {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function urls(calls: readonly Recorded[]): readonly string[] {
  return calls.map((call) => call.url);
}

function listCalls(calls: readonly Recorded[]): readonly URL[] {
  return calls
    .filter((call) => call.url.startsWith(MESSAGES_URL) && !call.url.includes('/messages/'))
    .map((call) => new URL(call.url));
}

function messageCalls(calls: readonly Recorded[]): readonly string[] {
  return calls
    .filter((call) => call.url.includes('/messages/'))
    .map((call) => new URL(call.url).pathname.split('/').pop() ?? '');
}

interface Script {
  readonly token?: () => Response;
  /** Answers page N (0-based). The adapter must ask for pages in order. */
  readonly page: (index: number) => Response;
  readonly message?: (id: string) => Response;
}

function fakeGoogle(script: Script): {
  readonly doFetch: typeof fetch;
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  let pageIndex = 0;

  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });

    if (url === TOKEN_URL) {
      return script.token === undefined ? tokenAnswer() : script.token();
    }

    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/gmail/v1/users/me/messages/')) {
      const id = decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
      if (script.message === undefined) {
        return jsonResponse(messageResource(id));
      }
      return script.message(id);
    }

    const answer = script.page(pageIndex);
    pageIndex += 1;
    return answer;
  }) as typeof fetch;

  return { doFetch, calls };
}

function reader(script: Script) {
  const fake = fakeGoogle(script);
  const gmail = createGmailReader({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    fetchImpl: fake.doFetch,
  });
  return { gmail, calls: fake.calls };
}

describe('createGmailReader: the happy path', () => {
  it('refreshes ONE access token for the whole call and maps a message to the port shape', async () => {
    const { gmail, calls } = reader({
      page: () => jsonResponse({ messages: [{ id: 'm1' }, { id: 'm2' }] }),
    });

    const result = await gmail.fetchRecent(QUERY);

    expect(result.status).toBe('ok');
    expect(urls(calls).filter((url) => url === TOKEN_URL)).toHaveLength(1);
    // Each listed id is fetched exactly once, in the order it was listed.
    expect(messageCalls(calls)).toEqual(['m1', 'm2']);

    const messages = result.status === 'ok' ? result.messages : [];
    expect(messages).toHaveLength(2);
    const first = messages[0] as MailMessage;
    // The display name never crosses the port: the address does.
    expect(first.from).toBe('jobs@example.com');
    expect(first.subject).toBe('Nuevas ofertas para ti');
    expect(first.snippet).toBe('snippet m1');
    expect(first.receivedAt.toISOString()).toBe(new Date(1772323200000).toISOString());
  });

  it('asks Gmail for the two headers it needs and nothing else', async () => {
    const { gmail, calls } = reader({
      page: () => jsonResponse({ messages: [{ id: 'm1' }] }),
    });

    await gmail.fetchRecent(QUERY);

    const detail = new URL(
      calls.find((call) => call.url.includes('/messages/'))?.url ?? MESSAGES_URL,
    );
    expect(detail.searchParams.get('format')).toBe('metadata');
    expect(detail.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
  });

  it('treats a mailbox with no matches as an empty result, not a shape error', async () => {
    const { gmail } = reader({ page: () => jsonResponse({}) });

    await expect(gmail.fetchRecent(QUERY)).resolves.toEqual({ status: 'ok', messages: [] });
  });
});

describe('createGmailReader: pagination', () => {
  it('follows nextPageToken to the last page', async () => {
    const { gmail, calls } = reader({
      page: (index) =>
        index === 0
          ? jsonResponse({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' })
          : jsonResponse({ messages: [{ id: 'm3' }] }),
    });

    const result = await gmail.fetchRecent(QUERY);

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' ? result.messages.map((m) => m.id) : []).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
    expect(listCalls(calls)).toHaveLength(2);
    expect(listCalls(calls)[1]?.searchParams.get('pageToken')).toBe('p2');
  });

  it('stops at the caller ceiling and asks the last page only for the remainder', async () => {
    const { gmail, calls } = reader({
      page: () => jsonResponse({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' }),
    });

    const result = await gmail.fetchRecent({ ...QUERY, maxResults: 3 });

    expect(result.status === 'ok' ? result.messages : []).toHaveLength(3);
    const pages = listCalls(calls);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.searchParams.get('maxResults')).toBe('3');
    // The first page yielded two ids, so the second may only ask for one.
    expect(pages[1]?.searchParams.get('maxResults')).toBe('1');
  });

  it('stops instead of looping forever when Google repeats the same page token', async () => {
    /*
     * A repeated token means the API answered something we cannot trust. The
     * old loop had no guard: with a repeated token and no new ids it never
     * returned, so one pathological answer was an unbounded request loop
     * inside the daily check.
     */
    let pages = 0;
    const { gmail, calls } = reader({
      page: () => {
        pages += 1;
        if (pages > 10) {
          throw new Error('the adapter kept asking for the same page');
        }
        return jsonResponse({ messages: [{ id: 'm1' }], nextPageToken: 'p2' });
      },
    });

    const result = await gmail.fetchRecent(QUERY);

    expect(result).toEqual({ status: 'unavailable', reason: 'bad_response' });
    expect(listCalls(calls)).toHaveLength(2);
  });
});

describe('createGmailReader: failures are values, never exceptions', () => {
  it('maps invalid_grant on the token exchange to auth_expired', async () => {
    const { gmail } = reader({
      token: () => jsonResponse({ error: 'invalid_grant' }, 400),
      page: () => jsonResponse({ messages: [] }),
    });

    await expect(gmail.fetchRecent(QUERY)).resolves.toEqual({ status: 'auth_expired' });
  });

  it('maps a rejected access token on the message list to auth_expired', async () => {
    /*
     * A 401 from Gmail means the access token was not accepted. The old map
     * turned it into `bad_response`, which is the one reason the user cannot
     * act on: re-running consent is exactly what fixes it.
     */
    const { gmail } = reader({ page: () => jsonResponse({ error: 'unauthorized' }, 401) });

    await expect(gmail.fetchRecent(QUERY)).resolves.toEqual({ status: 'auth_expired' });
  });

  it('maps a rejected access token on a single message to auth_expired', async () => {
    const { gmail } = reader({
      page: () => jsonResponse({ messages: [{ id: 'm1' }] }),
      message: () => jsonResponse({ error: 'unauthorized' }, 401),
    });

    await expect(gmail.fetchRecent(QUERY)).resolves.toEqual({ status: 'auth_expired' });
  });

  it('maps 429 to rate_limited and 5xx to server', async () => {
    const limited = reader({ page: () => jsonResponse({}, 429) });
    const broken = reader({ page: () => jsonResponse({}, 503) });

    await expect(limited.gmail.fetchRecent(QUERY)).resolves.toEqual({
      status: 'unavailable',
      reason: 'rate_limited',
    });
    await expect(broken.gmail.fetchRecent(QUERY)).resolves.toEqual({
      status: 'unavailable',
      reason: 'server',
    });
  });

  it('maps a thrown fetch to network and unparseable JSON to bad_response', async () => {
    const offline = reader({
      page: () => {
        throw new TypeError('fetch failed');
      },
    });
    const nonsense = reader({ page: () => new Response('<html>no</html>') });

    await expect(offline.gmail.fetchRecent(QUERY)).resolves.toEqual({
      status: 'unavailable',
      reason: 'network',
    });
    await expect(nonsense.gmail.fetchRecent(QUERY)).resolves.toEqual({
      status: 'unavailable',
      reason: 'bad_response',
    });
  });

  it('fails the whole call when ONE message cannot be read, returning no partial list', async () => {
    // Pinned as a decision, not as an accident: a half-read week would be
    // stored as if it were complete, and the proposals it missed would never
    // be made.
    const { gmail } = reader({
      page: () => jsonResponse({ messages: [{ id: 'm1' }, { id: 'm2' }] }),
      message: (id) => (id === 'm2' ? jsonResponse({}, 500) : jsonResponse(messageResource(id))),
    });

    await expect(gmail.fetchRecent(QUERY)).resolves.toEqual({
      status: 'unavailable',
      reason: 'server',
    });
  });

  it('fails instead of returning a partial list when a later page fails', async () => {
    const { gmail } = reader({
      page: (index) =>
        index === 0
          ? jsonResponse({ messages: [{ id: 'm1' }], nextPageToken: 'p2' })
          : jsonResponse({ error: 'boom' }, 500),
    });

    await expect(gmail.fetchRecent(QUERY)).resolves.toEqual({
      status: 'unavailable',
      reason: 'server',
    });
  });

  it('never puts a credential in a URL, an error message or the result', async () => {
    const { gmail, calls } = reader({
      page: () => jsonResponse({ messages: [{ id: 'm1' }] }),
    });

    const result = await gmail.fetchRecent(QUERY);

    const serialized = JSON.stringify(result);
    for (const secret of ['client-secret', 'refresh-token']) {
      expect(serialized).not.toContain(secret);
      for (const url of urls(calls)) {
        expect(url).not.toContain(secret);
        expect(decodeURIComponent(url)).not.toContain(secret);
      }
    }
    // The access token travels in a header only.
    const listRequest = calls.find((call) => call.url.startsWith(MESSAGES_URL));
    expect(JSON.stringify(listRequest?.init?.headers)).toContain('Bearer access-token-1');
  });
});
