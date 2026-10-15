import { clamp01 } from './text.js';

/**
 * RETIRED. Nothing in the pipeline, the CLI or the web app calls this.
 *
 * ------------------------------------------------------------------
 * What it was for
 * ------------------------------------------------------------------
 * Exploration quota: the fix for the RANKING's selection-bias problem.
 *
 * If the candidate only ever applies to the top of a score-ordered list, the
 * application log only ever contains outcomes for jobs the ranking already
 * liked. There is then no evidence that the ranking is WRONG - only evidence
 * about what it picked. So a configurable share of the surfaced slots was
 * deliberately spent on jobs from outside the top band, flagged so the UI could
 * label them honestly.
 *
 * ------------------------------------------------------------------
 * Why it is retired
 * ------------------------------------------------------------------
 * The product no longer orders by score. The list is every posting that passed
 * the two filters, newest first, and the candidate reads all of it. There is no
 * "top band" to be biased toward, so there is nothing to counteract: the
 * mechanism is not merely unused, it is meaningless in the current model.
 * Surfacing an "Exploración" badge over a recency-ordered list would have been
 * an explanation of something that is not happening.
 *
 * ------------------------------------------------------------------
 * Why the file still exists
 * ------------------------------------------------------------------
 * It is kept, unwired, still tested, and removed from the package's public
 * barrels, for one practical reason: this repository is not under version
 * control, so deleting it would be unrecoverable. It becomes correct again the
 * day score ordering returns - and if score ordering never returns, this file
 * and `config/exploration-config.ts` are the two to delete.
 *
 * Deterministic given a seed, which is what made it testable and what kept the
 * morning list stable across re-renders of the same run.
 */

export interface ExplorationOptions {
  /** Total entries to surface. */
  readonly limit: number;
  /** Share of `limit` spent on exploration. Clamped to 0..1. */
  readonly rate: number;
  /** Same seed, same sample. */
  readonly seed: string;
}

export interface SurfacedEntry<T> {
  readonly item: T;
  /** True when this entry was sampled from outside the top band. */
  readonly exploration: boolean;
}

/** FNV-1a. Cheap, dependency-free, and good enough to spread seeds apart. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, deterministic. No crypto, no dependency. */
function createRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher-Yates over a copy. */
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const a = result[index];
    const b = result[swap];
    if (a !== undefined && b !== undefined) {
      result[index] = b;
      result[swap] = a;
    }
  }
  return result;
}

/**
 * Positions in the surfaced list where exploration entries are planted.
 *
 * Evenly spread rather than appended: an exploration entry parked at the bottom
 * of the page is an exploration entry nobody looks at, which defeats the
 * mechanism entirely.
 */
function explorationPositions(total: number, count: number): Set<number> {
  const positions = new Set<number>();

  for (let index = 0; index < count; index += 1) {
    let position = Math.min(total - 1, Math.floor(((index + 1) * total) / (count + 1)));

    while (positions.has(position) && position < total - 1) {
      position += 1;
    }
    while (positions.has(position) && position > 0) {
      position -= 1;
    }
    positions.add(position);
  }

  return positions;
}

/**
 * Splits a ranked list into an exploited top band plus a sampled exploration
 * quota, then interleaves them.
 *
 * Generic over the entry type so the domain stays free of the queue DTO.
 *
 * Note: when the ranking is shorter than the limit, every job is surfaced
 * anyway. The flag then still means something real - "this one was not chosen
 * on merit" - even though nothing was left out.
 */
export function surfaceWithExploration<T>(
  ranked: readonly T[],
  options: ExplorationOptions,
): readonly SurfacedEntry<T>[] {
  const total = Math.max(0, Math.min(Math.floor(options.limit), ranked.length));
  if (total === 0) {
    return [];
  }

  const explorationCount = Math.round(total * clamp01(options.rate));
  const exploitCount = total - explorationCount;

  const exploited = ranked.slice(0, exploitCount);

  // The pool is everything the top band did not take. Because `total` never
  // exceeds `ranked.length`, the pool always holds at least `explorationCount`.
  const pool = ranked.slice(exploitCount);
  const poolIndexes = pool.map((_, index) => index);
  const sampledIndexes = shuffle(poolIndexes, createRandom(options.seed))
    .slice(0, explorationCount)
    // Restore ranked order among the picks: within the exploration quota,
    // better-scoring jobs still come first.
    .sort((a, b) => a - b);

  const explored = sampledIndexes.map((index) => pool[index]);
  const positions = explorationPositions(total, explorationCount);

  const surfaced: SurfacedEntry<T>[] = [];
  let exploitCursor = 0;
  let exploreCursor = 0;

  for (let slot = 0; slot < total; slot += 1) {
    if (positions.has(slot) && exploreCursor < explored.length) {
      const item = explored[exploreCursor];
      exploreCursor += 1;
      if (item !== undefined) {
        surfaced.push({ item, exploration: true });
        continue;
      }
    }

    const item = exploited[exploitCursor];
    exploitCursor += 1;
    if (item !== undefined) {
      surfaced.push({ item, exploration: false });
    }
  }

  return surfaced;
}
