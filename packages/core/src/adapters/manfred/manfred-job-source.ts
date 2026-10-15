import {
  DEFAULT_BOARD_TIMEOUT_MS,
  fetchBoardJson,
  fetchBoardText,
  mapWithConcurrency,
  type BoardFetch,
} from '../boards/board-http.js';
import {
  MANFRED_ACTIVE_STATUS,
  MANFRED_CONCURRENCY,
  MANFRED_DISPLAYABLE_CURRENCIES,
  MANFRED_MAX_DETAIL_FETCHES,
  MANFRED_OFFERS_URL,
  MANFRED_SITEMAP_URL,
  manfredDetailUrl,
} from '../../config/manfred.js';
import { createJob, type Job, type JobDraft } from '../../domain/job.js';
import type { JobSource, JobSourceQuery } from '../../ports/job-source.js';
import type { Logger } from '../../ports/logger.js';
import { joinManfredSections, markdownToPlainText } from './markdown-text.js';
import {
  manfredOfferDetailSchema,
  manfredOffersSchema,
  manfredOfferSchema,
  type ManfredOffer,
} from './manfred-schema.js';

/**
 * GETMANFRED - the Spanish tech market, and the first source that publishes pay.
 *
 * Read `src/config/manfred.ts` first: it holds the endpoint facts, the
 * parameter gotchas, and the argument for where an apply URL comes from. This
 * file is the assembly.
 *
 * THREE DECISIONS WORTH DEFENDING, because each one is a place where the
 * convenient version is wrong:
 *
 * 1. ACTIVE ONLY. 1627 of 1645 offers are CLOSED. This is an archive endpoint
 *    wearing a job-board's name, and shipping it whole would bury eighteen real
 *    vacancies and then spend 1645 liveness requests confirming that the
 *    archive is, indeed, an archive.
 *
 * 2. THE SITEMAP IS THE URL AUTHORITY. Not the id, not the slug, not a pattern
 *    that looked right. An offer missing from the sitemap is skipped.
 *
 * 3. A FAILED ENRICHMENT DEGRADES, A FAILED URL LOOKUP DELETES. Those are
 *    different failures and get different answers. Losing the prose costs the
 *    scorer some signal; losing the address means there is nothing to apply to,
 *    and this codebase does not ship a posting it cannot open.
 */

export const MANFRED_SOURCE_ID = 'manfred';

/** Printed in the source report. `per-run` sources never see a search term. */
export const MANFRED_SWEEP_LABEL = '(all Manfred offers)';

const MILLIS_PER_DAY = 86_400_000;

export interface ManfredJobSourceOptions {
  readonly logger: Logger;
  readonly fetchImpl?: BoardFetch;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
  readonly now?: () => Date;
  /** See `MANFRED_MAX_DETAIL_FETCHES`. Overridable so a test can pin it. */
  readonly maxDetailFetches?: number;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Every public offer address Manfred publishes, keyed by offer id.
 *
 * Parsed with a regex over `<loc>` rather than an XML parser: the only thing
 * being read is a flat list of URLs, and this project takes no native
 * dependencies. A `<loc>` whose path does not carry an offer id is ignored
 * rather than guessed at.
 */
export function parseManfredSitemap(xml: string): ReadonlyMap<string, string> {
  const byId = new Map<string, string>();

  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = match[1];
    if (url === undefined) {
      continue;
    }
    const id = /\/ofertas-empleo\/(\d+)(?:\/|$)/.exec(url)?.[1];
    if (id !== undefined) {
      byId.set(id, url);
    }
  }

  return byId;
}

/**
 * The description an offer ships with when nothing has been fetched for it yet.
 *
 * `highlights` are marketing bullets ("🏠 Híbrido", "🤓 Aprendizaje continuo"),
 * and the remote share is folded in as text because `Job` has no field for it -
 * see the note on the domain model in the report. Both come straight off the
 * payload, so nothing here is invented.
 */
function listLevelDescription(offer: ManfredOffer): string {
  const parts: string[] = [];

  if (typeof offer.remotePercentage === 'number') {
    parts.push(`Remote: ${offer.remotePercentage}%`);
  }
  if (offer.offerLanguages.length > 0) {
    parts.push(`Idiomas de la oferta: ${offer.offerLanguages.join(', ')}`);
  }
  if (offer.highlights.length > 0) {
    parts.push(markdownToPlainText(offer.highlights.join('\n')));
  }

  return parts.join('\n');
}

/** `salaryFrom`/`salaryTo`, but only when the queue could display them honestly. */
function salaryFor(offer: ManfredOffer): { min: number | null; max: number | null } {
  if (!MANFRED_DISPLAYABLE_CURRENCIES.has(offer.currency.trim())) {
    return { min: null, max: null };
  }
  return { min: offer.salaryFrom, max: offer.salaryTo };
}

export function createManfredJobSource(options: ManfredJobSourceOptions): JobSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOARD_TIMEOUT_MS;
  const concurrency = options.concurrency ?? MANFRED_CONCURRENCY;
  const maxDetailFetches = options.maxDetailFetches ?? MANFRED_MAX_DETAIL_FETCHES;
  const now = options.now ?? (() => new Date());

  const httpOptions = {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    timeoutMs,
  };

  /** The prose for one offer, or `null` when the extra request did not pay off. */
  async function fetchDetail(offer: ManfredOffer): Promise<string | null> {
    try {
      const payload = await fetchBoardJson(manfredDetailUrl(offer.id), httpOptions);
      const parsed = manfredOfferDetailSchema.safeParse(payload);
      if (!parsed.success) {
        options.logger.warn(
          `[${MANFRED_SOURCE_ID}] offer ${offer.id}: detail payload was unrecognizable, ` +
            'keeping the offer with its list-level description',
        );
        return null;
      }

      const detail = parsed.data;
      const prose = joinManfredSections([
        detail.introduction,
        detail.whatWillYouDo,
        detail.responsibilities,
        detail.howWillYouDoIt,
        detail.whatTheyAskFor,
        detail.whatOffering,
        detail.whereWillDoIt,
        detail.whoWillDoItWith,
      ]);

      const techs = detail.techs.map((tech) => tech.name).filter((name) => name.length > 0);
      const skills = detail.softSkills.map((skill) => skill.name).filter((name) => name.length > 0);

      return [prose, techs.length > 0 ? `Stack: ${techs.join(', ')}` : '', skills.length > 0 ? `Soft skills: ${skills.join(', ')}` : '']
        .filter((part) => part.length > 0)
        .join('\n');
    } catch (cause: unknown) {
      // Absorbed on purpose. The vacancy is real and its address is known; a
      // failed second request is a fact about the network, and this pipeline
      // does not delete opportunities on those.
      options.logger.warn(
        `[${MANFRED_SOURCE_ID}] offer ${offer.id}: could not load the full description ` +
          `(${errorMessage(cause)}); keeping it with the summary Manfred returned in the list`,
      );
      return null;
    }
  }

  return {
    id: MANFRED_SOURCE_ID,

    /*
     * Not a search engine. `/public/offers` takes no query term - it answers
     * with the entire catalogue however it is asked - so running the seven-term
     * plan against it would be seven identical requests and seven duplicate
     * rows in the run summary.
     */
    queryMode: 'per-run',
    sweepLabel: MANFRED_SWEEP_LABEL,

    async fetchJobs(query: JobSourceQuery): Promise<readonly Job[]> {
      const payload = await fetchBoardJson(MANFRED_OFFERS_URL, httpOptions);

      const envelope = manfredOffersSchema.safeParse(payload);
      if (!envelope.success) {
        throw new Error('manfred returned an unrecognized payload: the offers list was not an array');
      }

      const oldestAllowed = now().getTime() - query.maxDaysOld * MILLIS_PER_DAY;

      const offers: ManfredOffer[] = [];
      let malformed = 0;

      for (const raw of envelope.data) {
        const parsed = manfredOfferSchema.safeParse(raw);
        if (!parsed.success) {
          malformed += 1;
          continue;
        }

        const offer = parsed.data;
        if (offer.status.toUpperCase() !== MANFRED_ACTIVE_STATUS) {
          continue;
        }

        const postedAt = new Date(offer.updatedAt);
        if (Number.isNaN(postedAt.getTime()) || postedAt.getTime() < oldestAllowed) {
          continue;
        }

        offers.push(offer);
      }

      if (malformed > 0) {
        options.logger.warn(
          `[${MANFRED_SOURCE_ID}] skipped ${malformed} offer(s) whose shape the schema did not recognize`,
        );
      }

      if (offers.length === 0) {
        return [];
      }

      /*
       * THE URL AUTHORITY, fetched before anything is built.
       *
       * Deliberately NOT absorbed: without it there are no addresses, and the
       * only alternative to failing here is inventing them. Throwing lets the
       * source report say "manfred failed" and lets the degraded-write guard in
       * `persist-queue.ts` protect the previous queue - which is the correct
       * outcome, and strictly better than a queue full of guessed links.
       */
      let urlById: ReadonlyMap<string, string>;
      try {
        urlById = parseManfredSitemap(await fetchBoardText(MANFRED_SITEMAP_URL, httpOptions));
      } catch (cause: unknown) {
        throw new Error(
          `manfred's offer sitemap (${MANFRED_SITEMAP_URL}) could not be read (${errorMessage(cause)}). ` +
            'It is the only place this API publishes a posting\'s public address, and a URL built ' +
            'from the id and slug is a guess, so no offers were produced rather than fabricated ones.',
        );
      }

      // Enrichment is bounded; intake is not. Offers past the bound still ship,
      // with the description the list endpoint gave.
      const enrichable = offers.slice(0, maxDetailFetches);
      if (offers.length > enrichable.length) {
        options.logger.info(
          `[${MANFRED_SOURCE_ID}] ${offers.length} active offers exceed the ${maxDetailFetches}-request ` +
            'enrichment bound; the remainder keep their list-level description',
        );
      }

      const details = await mapWithConcurrency(enrichable, concurrency, fetchDetail);
      const detailById = new Map<string, string>();
      enrichable.forEach((offer, index) => {
        const detail = details[index];
        if (typeof detail === 'string' && detail.length > 0) {
          detailById.set(offer.id, detail);
        }
      });

      const jobs: Job[] = [];
      let withoutUrl = 0;

      for (const offer of offers) {
        const url = urlById.get(offer.id);
        if (url === undefined) {
          withoutUrl += 1;
          continue;
        }

        const summary = listLevelDescription(offer);
        const detail = detailById.get(offer.id);
        const salary = salaryFor(offer);

        const draft: JobDraft = {
          sourceId: MANFRED_SOURCE_ID,
          externalId: offer.id,
          title: offer.position,
          company: offer.company.name,
          // `locations` is empty for 940 of 1645 offers. An empty string is the
          // honest answer; "Madrid" or "España" would be an invention, and
          // location is the field this candidate filters on hardest.
          location: offer.locations[0] ?? '',
          description: [summary, detail ?? ''].filter((part) => part.length > 0).join('\n'),
          url,
          postedAt: new Date(offer.updatedAt),
          salaryMin: salary.min,
          salaryMax: salary.max,
          contractType: offer.isFreelance === true ? 'freelance' : null,
        };

        try {
          jobs.push(createJob(draft));
        } catch (cause: unknown) {
          options.logger.warn(
            `[${MANFRED_SOURCE_ID}] skipped an offer: ${errorMessage(cause)}`,
          );
        }
      }

      if (withoutUrl > 0) {
        options.logger.warn(
          `[${MANFRED_SOURCE_ID}] ${withoutUrl} active offer(s) are absent from the published ` +
            'sitemap, so no public address for them could be read. They were skipped rather than ' +
            'given a URL assembled from their id and slug.',
        );
      }

      return jobs;
    },
  };
}
