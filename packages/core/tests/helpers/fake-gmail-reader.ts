import type { GmailFetchResult, GmailQuery, GmailReader } from '../../src/ports/gmail-reader.js';

export interface FakeGmailReader extends GmailReader {
  readonly calls: GmailQuery[];
  /** Next results to serve, in order; the last one repeats. */
  script(...results: Array<GmailFetchResult | Error>): void;
  /** Hold every call until `release()` is invoked. */
  hold(): void;
  release(): void;
}

export function createFakeGmailReader(
  initial: GmailFetchResult | Error = { status: 'ok', messages: [] },
): FakeGmailReader {
  const calls: GmailQuery[] = [];
  let queue: Array<GmailFetchResult | Error> = [initial];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;

  return {
    calls,
    script: (...results) => {
      queue = results.length > 0 ? [...results] : [initial];
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => {
      open?.();
      gate = null;
      open = null;
    },
    async fetchRecent(query) {
      calls.push(query);
      if (gate) {
        await gate;
      }
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  };
}
