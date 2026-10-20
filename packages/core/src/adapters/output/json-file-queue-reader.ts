import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { APPLICATION_OUTCOMES } from '../../domain/application.js';
import { CV_CATEGORIES } from '../../domain/cv-category.js';
import { SCORE_DIMENSIONS } from '../../domain/scoring/types.js';
import type { QueueReader } from '../../ports/queue-reader.js';
import type { JobQueue } from '../../ports/queue-writer.js';

/**
 * Reads `output/queue.json` back into a validated `JobQueue`.
 *
 * The file is written by this codebase, but it is still a boundary: it can be
 * hand-edited, truncated by a killed process, or left over from an older
 * version of the pipeline that had no `requirements` field. Validating here
 * turns all of that into one actionable error instead of an `undefined` blowing
 * up somewhere inside a React render.
 */

const cvVariantSchema = z.enum(['frontend', 'microsoft', 'general']);

const breakdownItemSchema = z.object({
  dimension: z.enum(SCORE_DIMENSIONS as unknown as [string, ...string[]]),
  value: z.number(),
  weight: z.number(),
  contribution: z.number(),
  reason: z.string(),
});

const requirementsSchema = z.object({
  yearsRequired: z.number().nullable(),
  senioritySignals: z.array(
    z.object({
      term: z.string(),
      level: z.enum(['junior', 'senior']),
      where: z.enum(['title', 'description']),
    }),
  ),
  matchedStack: z.array(z.string()),
  cvVariant: cvVariantSchema,
  englishRequired: z.enum(['not_stated', 'basic', 'intermediate', 'advanced']),
  workMode: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
});

const cvCategorySchema = z.enum(CV_CATEGORIES);

/*
 * Optional, with NO default: a legacy entry made no analysis, and inventing a
 * `general` for it would claim it was analysed and found nothing. Unknown keys
 * (a stray model id or path) are stripped by zod's default object behaviour.
 */
const cvCategorySuggestionSchema = z.object({
  category: cvCategorySchema,
  matchedTerms: z.array(z.string()),
  reason: z.enum(['evidence', 'no_evidence', 'tie']),
  tiedCategories: z.array(cvCategorySchema).optional(),
});

const livenessRecordSchema = z.object({
  verdict: z.enum(['alive', 'gone', 'unverified']),
  status: z.number().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});

const queueEntrySchema = z.object({
  rank: z.number().int(),
  id: z.string().min(1),
  score: z.number(),
  cvVariant: cvVariantSchema,
  requirements: requirementsSchema,
  cvCategorySuggestion: cvCategorySuggestionSchema.optional(),
  applicationStatus: z.enum(['not_applied', ...APPLICATION_OUTCOMES]),
  appliedAt: z.string().nullable(),
  outcomeUpdatedAt: z.string().nullable(),
  notes: z.string().nullable(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  /*
   * Absolute, and enforced on the way IN as well as on the way out.
   *
   * A queue file is written by this codebase, which is exactly why it deserves
   * the check: the 13 dead apply buttons that started all of this lived in a
   * file this reader had already accepted. `z.string()` accepts "", "null" and
   * "/details/x" without complaint, and every one of those reaches a button.
   */
  url: z.string().url(),
  postedAt: z.string(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  contractType: z.string().nullable(),
  sources: z.array(
    z.object({ sourceId: z.string(), externalId: z.string(), url: z.string().url() }),
  ),
  breakdown: z.array(breakdownItemSchema),
  /*
   * Defaulted to `null`, which is the honest reading of an older file: a queue
   * written before liveness checking existed contains no claim about whether
   * its postings are still open, and `null` means exactly "not checked".
   *
   * The alternative - failing the parse - would black out the dashboard for
   * every user holding a queue from yesterday, in order to enforce a field
   * whose absence is harmless. The alternative in the other direction -
   * defaulting to `alive` - would be an invention, and the one invention this
   * feature must never make.
   */
  liveness: livenessRecordSchema.nullable().default(null),
});

const excludedEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string().url(),
  postedAt: z.string(),
  /*
   * Defaulted for files written before Filter B existed. This is not an
   * invention: at the time those files were produced, software relevance was
   * the ONLY filter that could remove a posting, so the default states a
   * historical fact rather than guessing at one.
   */
  excludedBy: z
    .enum([
      'software_relevance',
      'junior_eligibility',
      'location_incompatible',
      'experience_over_limit',
      'seniority_excluded',
      'dead_link',
    ])
    .default('software_relevance'),
  scoreBeforeGate: z.number(),
  softwareRelevance: z.number(),
  reason: z.string(),
});

const jobQueueSchema = z.object({
  generatedAt: z.string(),
  candidate: z.string(),
  totalFetched: z.number().int(),
  totalUnique: z.number().int(),
  // Defaulted, not required: a queue file written before the relevance gate
  // existed is still readable, it simply reports nothing excluded. Failing here
  // would black out the dashboard until the next pipeline run.
  totalRelevant: z.number().int().optional(),
  totalJuniorEligible: z.number().int().optional(),
  excluded: z.array(excludedEntrySchema).default([]),
  duplicatesRemoved: z.number().int(),
  sourceReports: z.array(
    z.object({
      sourceId: z.string(),
      query: z.string(),
      status: z.enum(['ok', 'failed']),
      fetched: z.number().int(),
      error: z.string().optional(),
    }),
  ),
  jobs: z.array(queueEntrySchema),
  // Absent on a queue written before liveness checking existed. Optional rather
  // than defaulted, because "this file makes no statement about liveness" and
  // "the check was off for that run" are different facts and the UI is entitled
  // to tell them apart.
  liveness: z
    .object({
      status: z.enum(['off', 'ran', 'failed']),
      checked: z.number().int(),
      alive: z.number().int(),
      gone: z.number().int(),
      unverified: z.number().int(),
      removed: z.number().int(),
      requests: z.number().int(),
      fromCache: z.number().int(),
      error: z.string().optional(),
    })
    .optional(),
});

export interface JsonFileQueueReaderOptions {
  readonly filePath: string;
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'ENOENT'
  );
}

export function createJsonFileQueueReader(
  options: JsonFileQueueReaderOptions,
): QueueReader {
  const target = resolve(options.filePath);

  return {
    async read(): Promise<JobQueue | null> {
      let raw: string;
      try {
        raw = await readFile(target, 'utf8');
      } catch (cause: unknown) {
        // No run yet is a normal first-launch state, not a failure.
        if (isMissingFile(cause)) {
          return null;
        }
        throw cause;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        throw new Error(`The queue file at ${target} is not valid JSON. Re-run the pipeline.`);
      }

      const parsed = jobQueueSchema.safeParse(parsedJson);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `The queue file at ${target} does not match the current queue format` +
            `${issue === undefined ? '' : ` (${issue.path.join('.')}: ${issue.message})`}. ` +
            'It was probably written by an older version - re-run the pipeline.',
        );
      }

      return {
        ...parsed.data,
        totalRelevant: parsed.data.totalRelevant ?? parsed.data.jobs.length,
        totalJuniorEligible: parsed.data.totalJuniorEligible ?? parsed.data.jobs.length,
      } as JobQueue;
    },
  };
}
