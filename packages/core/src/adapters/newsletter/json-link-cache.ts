import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CachedResolution, LinkResolutionCache } from './link-resolver.js';

/**
 * The link cache, and simultaneously the PROVENANCE RECORD.
 *
 * One JSON file mapping every tracking link the pipeline has ever followed to
 * the address it landed on:
 *
 *   {
 *     "https://juniorjobs.short.gy/2sxqtb": {
 *       "finalUrl": "https://factorialhr.com/careers/gtm-engineer-...",
 *       "status": 200,
 *       "resolved": true,
 *       "resolvedAt": "2026-09-08T08:14:02.113Z"
 *     }
 *   }
 *
 * It exists for two reasons at once, and both matter:
 *
 *   1. Politeness. A re-run costs zero requests to somebody else's shortener.
 *   2. Auditability. "Which URL did the newsletter give us, and which one did we
 *      show?" is answerable by opening a file, rather than by trusting a claim
 *      in a report. If an apply button ever points somewhere wrong, this is the
 *      file that says whether the pipeline was told to go there.
 *
 * Plain JSON, human-readable and human-editable, for exactly that reason.
 */

export interface JsonLinkCacheOptions {
  readonly filePath: string;
}

export function createJsonLinkCache(options: JsonLinkCacheOptions): LinkResolutionCache {
  return {
    async load(): Promise<unknown> {
      try {
        return JSON.parse(await readFile(options.filePath, 'utf8')) as unknown;
      } catch (cause: unknown) {
        // A cache that is missing and a cache that is corrupt lead to the same
        // safe place: resolve from scratch. Neither is worth failing a run for.
        if ((cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
          return {};
        }
        throw cause;
      }
    },

    async save(entries: Readonly<Record<string, CachedResolution>>): Promise<void> {
      await mkdir(dirname(options.filePath), { recursive: true });
      await writeFile(options.filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    },
  };
}
