import { resolve } from 'node:path';
import { WORKSPACE_ROOT, resolveDataPath } from './paths.js';

/**
 * Where the newsletter adapter looks, and where it remembers.
 *
 * Both are overridable from the environment for the same reason every other
 * shared location is (see `paths.ts`): a process that boots the real app must
 * be able to be pointed at a scratch directory without a test-only branch
 * inside the app.
 */

/**
 * The folder the user drops saved job-alert emails into.
 *
 * It lives under `data/` rather than `output/` because it is INPUT the human
 * produced, not something the pipeline generated - `output/` is disposable and
 * git-ignored, and a folder of saved emails is neither.
 */
export const DEFAULT_NEWSLETTER_DIR = resolveDataPath(
  'JOB_QUEUE_NEWSLETTER_DIR',
  resolve(WORKSPACE_ROOT, 'data/newsletters'),
);

/**
 * The resolved-link cache, which doubles as the URL provenance record.
 *
 * Dot-prefixed and kept inside the input folder so it sits next to the emails
 * it describes, and so a user browsing that folder is not confused into
 * thinking it is another newsletter to be parsed. The adapter only reads
 * `.txt`/`.eml`/`.text`, so it can never try to parse its own cache.
 */
export const DEFAULT_NEWSLETTER_LINK_CACHE = resolveDataPath(
  'JOB_QUEUE_NEWSLETTER_LINK_CACHE',
  resolve(WORKSPACE_ROOT, 'data/newsletters/.link-cache.json'),
);

/**
 * Simultaneous redirect lookups when `--resolve-links` is on.
 *
 * Small, and for the same reason the board concurrency is small: this is
 * somebody else's free shortener, and the only thing limiting our traffic is
 * our own restraint.
 */
export const DEFAULT_NEWSLETTER_LINK_CONCURRENCY = 4;
