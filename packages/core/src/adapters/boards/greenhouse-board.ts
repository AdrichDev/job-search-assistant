import { z } from 'zod';
import type { CompanyBoard } from '../../config/company-boards.js';
import type { JobSource } from '../../ports/job-source.js';
import {
  createBoardJobSource,
  type BoardPosting,
  type BoardProvider,
  type BoardSourceFactoryOptions,
} from './board-job-source.js';
import { htmlToPlainText } from './html-text.js';

export const GREENHOUSE_SOURCE_ID = 'greenhouse';
export const GREENHOUSE_BASE_URL = 'https://boards-api.greenhouse.io/v1/boards';

/**
 * Greenhouse job board API.
 *
 * `?content=true` was verified against the live endpoint rather than assumed:
 * without it the response carries no description at all (13 fields, no
 * `content`), and with it the payload gains `content`, `departments` and
 * `offices`. Since scoring is almost entirely description-driven, omitting the
 * parameter would produce postings that always score as "no signal found".
 *
 * The `content` field arrives as ESCAPED HTML (`&lt;p&gt;...`), not HTML - a
 * detail worth stating because it silently defeats the naive tag-strip that
 * works on every other board. `htmlToPlainText` handles both.
 */
const greenhouseJobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().min(1),
  absolute_url: z.string().url(),
  location: z.object({ name: z.string().default('') }).default({ name: '' }),
  content: z.string().default(''),
  company_name: z.string().optional(),
  /** When the vacancy went live. */
  first_published: z.string().optional(),
  /** Board-wide touch timestamp; only a fallback. See the note below. */
  updated_at: z.string().optional(),
});

const greenhouseEnvelopeSchema = z.object({ jobs: z.array(z.unknown()) });

export const greenhouseProvider: BoardProvider = {
  id: GREENHOUSE_SOURCE_ID,

  boardUrl(company: CompanyBoard): string {
    return `${GREENHOUSE_BASE_URL}/${company.slug}/jobs?content=true`;
  },

  parseBoard(payload, context): readonly BoardPosting[] {
    const envelope = greenhouseEnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      throw new Error('greenhouse returned an unrecognized payload: no "jobs" array');
    }

    const postings: BoardPosting[] = [];

    for (const raw of envelope.data.jobs) {
      const parsed = greenhouseJobSchema.safeParse(raw);
      if (!parsed.success) {
        context.skip(parsed.error.issues[0]?.message ?? 'unknown shape');
        continue;
      }

      const job = parsed.data;

      /*
       * `first_published` over `updated_at`, deliberately.
       *
       * `updated_at` is identical across an entire board because it moves every
       * time anything on it changes. Using it would date every vacancy as
       * "today" and hand the recency dimension to whichever company edited its
       * board most recently - which is noise, not freshness.
       */
      const rawDate = job.first_published ?? job.updated_at;
      if (rawDate === undefined) {
        context.skip(`${job.id}: no publication date`);
        continue;
      }

      const postedAt = new Date(rawDate);
      if (Number.isNaN(postedAt.getTime())) {
        context.skip(`${job.id}: unparsable date "${rawDate}"`);
        continue;
      }

      const location = job.location.name.trim();

      postings.push({
        draft: {
          sourceId: GREENHOUSE_SOURCE_ID,
          externalId: job.id,
          title: job.title,
          // The payload's own name wins; the config is the fallback for the
          // boards that omit it.
          company: job.company_name?.trim() || context.company.displayName,
          location,
          description: htmlToPlainText(job.content),
          url: job.absolute_url,
          postedAt,
          // Greenhouse's board API exposes no compensation field whatsoever.
          // Reporting null is honest; inventing a range would poison the score.
          salaryMin: null,
          salaryMax: null,
          contractType: null,
        },
        locationCandidates: [location],
      });
    }

    return postings;
  },
};

export function createGreenhouseJobSource(options: BoardSourceFactoryOptions): JobSource {
  return createBoardJobSource(greenhouseProvider, options);
}
