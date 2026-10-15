import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_USER_AGENT,
  fetchBoardJson,
  mapWithConcurrency,
} from '../../../src/adapters/boards/board-http.js';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';

function okResponse(payload: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => payload };
}

describe('mapWithConcurrency', () => {
  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('preserves input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([30, 10, 20], 3, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], 4, async (value) => value)).toEqual([]);
  });

  it('runs sequentially when the limit is 1', async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2, 3], 1, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return value;
    });
    expect(peak).toBe(1);
  });

  it('rejects a non-positive limit instead of hanging forever', async () => {
    await expect(mapWithConcurrency([1], 0, async (v) => v)).rejects.toThrow(/concurrency/i);
  });
});

describe('fetchBoardJson', () => {
  it('sends an identifying User-Agent and asks for JSON', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: BoardFetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return okResponse({ ok: true });
    };

    await fetchBoardJson('https://example.test/board', { fetchImpl, timeoutMs: 1000 });

    expect(seen[0]?.headers['User-Agent']).toBe(BOARD_USER_AGENT);
    expect(BOARD_USER_AGENT).toMatch(/job-queue/i);
    expect(seen[0]?.headers['Accept']).toBe('application/json');
  });

  it('returns the parsed body on success', async () => {
    const fetchImpl: BoardFetch = async () => okResponse({ jobs: [1, 2] });
    expect(await fetchBoardJson('https://example.test/b', { fetchImpl, timeoutMs: 1000 })).toEqual({
      jobs: [1, 2],
    });
  });

  it('throws a readable error including the status code', async () => {
    const fetchImpl: BoardFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    await expect(
      fetchBoardJson('https://example.test/nope', { fetchImpl, timeoutMs: 1000 }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('aborts a request that outlives the timeout', async () => {
    const fetchImpl: BoardFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('aborted by signal'));
        });
      });

    await expect(
      fetchBoardJson('https://example.test/slow', { fetchImpl, timeoutMs: 10 }),
    ).rejects.toThrow(/timed out after 10ms/i);
  });

  it('clears its timer on success so the process can exit', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const fetchImpl: BoardFetch = async () => okResponse({});
    await fetchBoardJson('https://example.test/b', { fetchImpl, timeoutMs: 5000 });
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('surfaces a body that is not JSON as a readable error', async () => {
    const fetchImpl: BoardFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    await expect(
      fetchBoardJson('https://example.test/html', { fetchImpl, timeoutMs: 1000 }),
    ).rejects.toThrow(/did not return JSON/i);
  });
});
