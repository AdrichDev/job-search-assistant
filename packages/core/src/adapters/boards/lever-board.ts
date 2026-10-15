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

export const LEVER_SOURCE_ID = 'lever';
export const LEVER_BASE_URL = 'https://api.lever.co/v0/postings';

/**
 * Lever postings API.
 *
 * Two shape differences from the other two boards, both easy to get wrong:
 *
 *  1. The body is a BARE ARRAY, not an object with a `jobs` key.
 *  2. `createdAt` is epoch MILLISECONDS, not an ISO string.
 *
 * A 404 from this endpoint means the company is not on Lever - it is not an
 * outage. Every slug in `company-boards.ts` was checked before being committed
 * for exactly that reason.
 *
 * Lever already ships `descriptionPlain`, so no decoding is normally needed;
 * the HTML fallback exists only for the postings that omit it.
 */
const leverJobSchema = z.object({
  id: z.string().min(1),
  /** Lever calls the title `text`. */
  text: z.string().min(1),
  hostedUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  createdAt: z.number().optional(),
  categories: z
    .object({
      location: z.string().optional(),
      allLocations: z.array(z.string()).optional(),
      commitment: z.string().optional(),
    })
    .default({}),
  descriptionPlain: z.string().optional(),
  description: z.string().optional(),
  additionalPlain: z.string().optional(),
});

export const leverProvider: BoardProvider = {
  id: LEVER_SOURCE_ID,

  boardUrl(company: CompanyBoard): string {
    return `${LEVER_BASE_URL}/${company.slug}?mode=json`;
  },

  parseBoard(payload, context): readonly BoardPosting[] {
    if (!Array.isArray(payload)) {
      throw new Error('lever returned an unrecognized payload: expected a JSON array of postings');
    }

    const postings: BoardPosting[] = [];

    for (const raw of payload) {
      const parsed = leverJobSchema.safeParse(raw);
      if (!parsed.success) {
        context.skip(parsed.error.issues[0]?.message ?? 'unknown shape');
        continue;
      }

      const job = parsed.data;

      if (job.createdAt === undefined) {
        context.skip(`${job.id}: no createdAt`);
        continue;
      }
      const postedAt = new Date(job.createdAt);
      if (Number.isNaN(postedAt.getTime())) {
        context.skip(`${job.id}: unparsable createdAt "${job.createdAt}"`);
        continue;
      }

      const allLocations = job.categories.allLocations ?? [];
      const primary = job.categories.location?.trim() ?? '';
      const location = primary.length > 0 ? primary : allLocations.join(' | ');

      const description =
        job.descriptionPlain ??
        (job.description === undefined ? '' : htmlToPlainText(job.description));

      postings.push({
        draft: {
          sourceId: LEVER_SOURCE_ID,
          externalId: job.id,
          title: job.text,
          // Lever's payload carries no employer name at all, so the config is
          // the only source of truth for it.
          company: context.company.displayName,
          location,
          description: [description, job.additionalPlain ?? ''].join('\n').trim(),
          url: job.hostedUrl,
          postedAt,
          salaryMin: null,
          salaryMax: null,
          contractType: job.categories.commitment ?? null,
        },
        locationCandidates: [primary, ...allLocations].filter((entry) => entry.length > 0),
      });
    }

    return postings;
  },
};

export function createLeverJobSource(options: BoardSourceFactoryOptions): JobSource {
  return createBoardJobSource(leverProvider, options);
}
