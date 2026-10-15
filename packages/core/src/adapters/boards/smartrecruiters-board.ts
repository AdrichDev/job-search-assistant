import { z } from 'zod';
import type { CompanyBoard } from '../../config/company-boards.js';
import type { JobSource } from '../../ports/job-source.js';
import {
  createBoardJobSource,
  type BoardHydrateContext,
  type BoardPosting,
  type BoardProvider,
  type BoardSourceFactoryOptions,
} from './board-job-source.js';
import { htmlToPlainText } from './html-text.js';

export const SMARTRECRUITERS_SOURCE_ID = 'smartrecruiters';
export const SMARTRECRUITERS_BASE_URL = 'https://api.smartrecruiters.com/v1/companies';

/**
 * SmartRecruiters posting API - the fourth company-board provider.
 *
 * It is the same shape as Greenhouse, Lever and Ashby (per company, no key, no
 * search endpoint) and therefore reuses the same source. Two things about it
 * are genuinely different, and both were learned by probing rather than
 * assuming:
 *
 * ## 1. `?country=es` is honoured, and the case matters
 *
 * Bosch publishes 4824 postings worldwide and 66 in Spain. Fetching the board
 * and filtering here would be 49 paged requests per run against a free endpoint
 * to arrive at the same 66 rows. The server will do it in one.
 *
 * `country=ES` in upper case returns zero results rather than an error, so the
 * lowercase form is pinned by a test. A silent zero is the worst kind of bug on
 * a source whose failure mode is "quietly contributes nothing forever".
 *
 * ## 2. The list payload has no apply URL, so it has to be asked for
 *
 * A list entry carries `id`, `name`, `location`, `company` and a `ref` - and
 * `ref` is an API endpoint, not something a browser opens. The public address
 * and the job ad both live on the per-posting detail endpoint, which reports
 * them as `postingUrl` and `jobAd.sections`.
 *
 * `https://jobs.smartrecruiters.com/{company}/{id}` does answer HTTP 200. It is
 * still not used, and that is deliberate: it is an address assembled from the
 * id and the company, which is exactly the construction `domain/job.ts`
 * forbids, and "it happened to work when I tried it" is the reasoning that put
 * thirteen dead apply buttons in front of this candidate once already. The
 * detail endpoint states the address, so the detail endpoint is asked - once
 * per posting that already survived the location and age filters.
 *
 * ## A note for whoever adds a slug
 *
 * An UNKNOWN company answers HTTP 200 with `totalFound: 0`. A status code
 * proves nothing here. See `config/company-boards.ts` for what does.
 */

const smartRecruitersLocationSchema = z
  .object({
    city: z.string().default(''),
    region: z.string().default(''),
    country: z.string().default(''),
    fullLocation: z.string().default(''),
    remote: z.boolean().nullish(),
  })
  .default({ city: '', region: '', country: '', fullLocation: '' });

const smartRecruitersPostingSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().min(1),
  releasedDate: z.string().min(1),
  location: smartRecruitersLocationSchema,
  company: z.object({ name: z.string().default('') }).default({ name: '' }),
});

const smartRecruitersEnvelopeSchema = z.object({ content: z.array(z.unknown()) });

/** One block of the job ad. Every field optional: half-filled ads are common. */
const jobAdSectionSchema = z
  .object({ title: z.string().default(''), text: z.string().default('') })
  .partial()
  .passthrough();

const smartRecruitersDetailSchema = z.object({
  /** THE address. The only field here that is not optional. */
  postingUrl: z.string().url(),
  jobAd: z
    .object({
      sections: z.record(jobAdSectionSchema).default({}),
    })
    .default({ sections: {} }),
});

function postingsUrl(company: CompanyBoard): string {
  // `limit=100` is the API's maximum page size. One page is enough for every
  // seeded company: the largest Spanish board seen was 85 postings.
  return `${SMARTRECRUITERS_BASE_URL}/${company.slug}/postings?country=es&limit=100`;
}

function detailUrl(company: CompanyBoard, postingId: string): string {
  return `${SMARTRECRUITERS_BASE_URL}/${company.slug}/postings/${encodeURIComponent(postingId)}`;
}

export const smartRecruitersProvider: BoardProvider = {
  id: SMARTRECRUITERS_SOURCE_ID,

  boardUrl: postingsUrl,

  parseBoard(payload, context): readonly BoardPosting[] {
    const envelope = smartRecruitersEnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      throw new Error('smartrecruiters returned an unrecognized payload: no "content" array');
    }

    const postings: BoardPosting[] = [];

    for (const raw of envelope.data.content) {
      const parsed = smartRecruitersPostingSchema.safeParse(raw);
      if (!parsed.success) {
        context.skip(parsed.error.issues[0]?.message ?? 'unknown shape');
        continue;
      }

      const posting = parsed.data;
      const postedAt = new Date(posting.releasedDate);
      if (Number.isNaN(postedAt.getTime())) {
        context.skip(`${posting.id}: unparsable date "${posting.releasedDate}"`);
        continue;
      }

      const location = posting.location.city.trim();

      postings.push({
        draft: {
          sourceId: SMARTRECRUITERS_SOURCE_ID,
          externalId: posting.id,
          title: posting.name,
          company: posting.company.name.trim() || context.company.displayName,
          location,
          // Both filled in by `hydrate`. The URL is deliberately left empty
          // rather than pre-filled with a construction: if hydration never
          // runs, `createJob` refuses the draft, which is the correct outcome.
          description: '',
          url: '',
          postedAt,
          // SmartRecruiters' postings API exposes no compensation field.
          salaryMin: null,
          salaryMax: null,
          contractType: null,
        },
        locationCandidates: [
          location,
          posting.location.region,
          posting.location.country,
          posting.location.fullLocation,
        ].filter((candidate) => candidate.length > 0),
      });
    }

    return postings;
  },

  async hydrate(
    postings: readonly BoardPosting[],
    context: BoardHydrateContext,
  ): Promise<readonly BoardPosting[]> {
    const hydrated = await context.mapBounded(postings, async (posting) => {
      const id = posting.draft.externalId;
      try {
        const payload = await context.fetchJson(detailUrl(context.company, id));
        const parsed = smartRecruitersDetailSchema.safeParse(payload);
        if (!parsed.success) {
          context.skip(`${id}: the detail payload carried no usable postingUrl`);
          return null;
        }

        const detail = parsed.data;
        const description = Object.values(detail.jobAd.sections)
          .map((section) =>
            [section.title ?? '', htmlToPlainText(section.text ?? '')]
              .filter((part) => part.length > 0)
              .join('\n'),
          )
          .filter((part) => part.length > 0)
          .join('\n');

        return {
          ...posting,
          draft: { ...posting.draft, url: detail.postingUrl, description },
        } satisfies BoardPosting;
      } catch (cause: unknown) {
        // One posting lost, not one board. Its address was never reported, and
        // the alternative to dropping it is assembling one.
        context.skip(
          `${id}: its detail endpoint failed (${cause instanceof Error ? cause.message : String(cause)})`,
        );
        return null;
      }
    });

    return hydrated.filter((posting): posting is BoardPosting => posting !== null);
  },
};

export function createSmartRecruitersJobSource(options: BoardSourceFactoryOptions): JobSource {
  return createBoardJobSource(smartRecruitersProvider, options);
}
