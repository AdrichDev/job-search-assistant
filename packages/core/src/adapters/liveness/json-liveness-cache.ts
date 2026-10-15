import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CachedLiveness, LivenessCache } from './http-link-checker.js';

/**
 * The liveness cache, and simultaneously the REMOVAL EVIDENCE FILE.
 *
 * One JSON file mapping every address the pipeline has checked to what it
 * answered and when:
 *
 *   {
 *     "https://juniorjobs.short.gy/hh6WWK": {
 *       "verdict": "gone",
 *       "status": 404,
 *       "checkedAt": "2026-09-10T08:14:02.113Z"
 *     }
 *   }
 *
 * It exists for two reasons at once, exactly like `.link-cache.json` next door,
 * and the second one is why it is plain readable JSON rather than anything
 * cleverer:
 *
 *   1. Politeness. A re-run within the TTL costs zero requests to somebody
 *      else's careers server.
 *   2. EVIDENCE. This pipeline now deletes postings. "Why is that job not in my
 *      list any more?" has to be answerable by opening a file and reading a
 *      status code, not by trusting a summary line that has already scrolled
 *      past. A deletion whose justification cannot be inspected afterwards is
 *      indistinguishable from a bug.
 *
 * It lives beside the queue rather than inside `data/newsletters/` because
 * liveness is checked for EVERY source - a Greenhouse posting closes as often
 * as a shortened one, it just does it more quietly.
 */

export interface JsonLivenessCacheOptions {
  readonly filePath: string;
}

export function createJsonLivenessCache(options: JsonLivenessCacheOptions): LivenessCache {
  return {
    async load(): Promise<unknown> {
      try {
        return JSON.parse(await readFile(options.filePath, 'utf8')) as unknown;
      } catch (cause: unknown) {
        // Missing and corrupt lead to the same safe place: check from scratch.
        // Neither is worth failing a run for, and neither may remove anything.
        if ((cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
          return {};
        }
        throw cause;
      }
    },

    async save(entries: Readonly<Record<string, CachedLiveness>>): Promise<void> {
      await mkdir(dirname(options.filePath), { recursive: true });
      await writeFile(options.filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    },
  };
}
