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

export const ASHBY_SOURCE_ID = 'ashby';
export const ASHBY_BASE_URL = 'https://api.ashbyhq.com/posting-api/job-board';

/**
 * Ashby job board API.
 *
 * The detail that matters here is `secondaryLocations`. Ashby publishes a
 * pan-European remote role as `location: "Berlin Office"` with Spain listed
 * only among the secondary locations - so an adapter that reads `location`
 * alone throws away exactly the remote-friendly roles a Madrid-based junior is
 * most likely to convert on. Both lists are carried into the location filter,
 * and both are shown, so the location scorer can see the Spanish leg too.
 *
 * `isListed: false` marks a posting the company has taken off its public board;
 * surfacing it would send the candidate to a dead application form.
 */
const ashbyJobSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  jobUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  location: z.string().default(''),
  secondaryLocations: z
    .array(z.object({ location: z.string().nullish() }).passthrough())
    .default([]),
  publishedAt: z.string().optional(),
  employmentType: z.string().nullish(),
  isListed: z.boolean().default(true),
  descriptionPlain: z.string().optional(),
  descriptionHtml: z.string().optional(),
});

const ashbyEnvelopeSchema = z.object({ jobs: z.array(z.unknown()) });

export const ashbyProvider: BoardProvider = {
  id: ASHBY_SOURCE_ID,

  boardUrl(company: CompanyBoard): string {
    return `${ASHBY_BASE_URL}/${company.slug}`;
  },

  parseBoard(payload, context): readonly BoardPosting[] {
    const envelope = ashbyEnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      throw new Error('ashby returned an unrecognized payload: no "jobs" array');
    }

    const postings: BoardPosting[] = [];

    for (const raw of envelope.data.jobs) {
      const parsed = ashbyJobSchema.safeParse(raw);
      if (!parsed.success) {
        context.skip(parsed.error.issues[0]?.message ?? 'unknown shape');
        continue;
      }

      const job = parsed.data;

      if (!job.isListed) {
        continue;
      }

      if (job.publishedAt === undefined) {
        context.skip(`${job.id}: no publishedAt`);
        continue;
      }
      const postedAt = new Date(job.publishedAt);
      if (Number.isNaN(postedAt.getTime())) {
        context.skip(`${job.id}: unparsable publishedAt "${job.publishedAt}"`);
        continue;
      }

      const primary = job.location.trim();
      const secondary = job.secondaryLocations
        .map((entry) => entry.location?.trim() ?? '')
        .filter((entry) => entry.length > 0);

      const candidates = [primary, ...secondary].filter((entry) => entry.length > 0);

      const description =
        job.descriptionPlain ??
        (job.descriptionHtml === undefined ? '' : htmlToPlainText(job.descriptionHtml));

      postings.push({
        draft: {
          sourceId: ASHBY_SOURCE_ID,
          externalId: job.id,
          title: job.title,
          // Ashby's payload has no employer name either.
          company: context.company.displayName,
          // Every location is shown, not just the primary one: a role open in
          // Berlin AND Spain is a different proposition from a Berlin-only one,
          // and the location scorer needs to see the difference.
          location: candidates.join(' | '),
          description,
          url: job.jobUrl,
          postedAt,
          salaryMin: null,
          salaryMax: null,
          contractType: job.employmentType ?? null,
        },
        locationCandidates: candidates,
      });
    }

    return postings;
  },
};

export function createAshbyJobSource(options: BoardSourceFactoryOptions): JobSource {
  return createBoardJobSource(ashbyProvider, options);
}
