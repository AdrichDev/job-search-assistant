import { resolve } from 'node:path';
import { WORKSPACE_ROOT, resolveDataPath } from './paths.js';

/**
 * Where the liveness pass remembers what it learned.
 *
 * Under `data/` rather than `output/` because `output/` is disposable and
 * git-ignored, and this file is the evidence trail for every posting the
 * pipeline has deleted. Losing it costs a run of extra requests to other
 * people's servers, and costs the answer to "why did that job disappear?".
 *
 * Dot-prefixed for the same reason `.link-cache.json` is: it sits among data a
 * human browses, and it is machinery rather than content.
 *
 * NOT inside `data/newsletters/`. Liveness is checked for every source, because
 * a Greenhouse or a search provider posting closes exactly as often as a shortened one -
 * it just does so without a redirect to make it obvious.
 */
export const DEFAULT_LIVENESS_CACHE_PATH = resolveDataPath(
  'JOB_QUEUE_LIVENESS_CACHE',
  resolve(WORKSPACE_ROOT, 'data/.link-liveness.json'),
);
