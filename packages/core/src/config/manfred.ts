/**
 * GETMANFRED - the Spanish tech job market, and the only source that publishes
 * salary.
 *
 * ## What was verified, and when
 *
 * Checked against the live API on 2026-09-10:
 *
 *   GET /api/v2/public/offers?lang=ES      -> HTTP 200, 1645 offers
 *   GET /api/v2/public/offers/{id}?lang=ES -> HTTP 200, the full prose
 *   GET /sitemap-offers.xml                -> HTTP 200, 1645 <loc> entries
 *
 * Two parameter facts worth writing down, because both cost a request to learn:
 *
 *   - `lang` is REQUIRED. Without it every path under `/public/offers` answers
 *     HTTP 400. That is also the real reason `?onlyActive=true` "fails": the
 *     API rejects parameters it does not know, so there is no server-side
 *     active filter to ask for. It is done here instead.
 *   - The per-offer detail route exists. It looked like it did not, because
 *     `/offers/8457` without `lang` returns 400 rather than 404.
 *
 * ## The number that matters
 *
 * 1645 offers, of which **18 were ACTIVE**. The other 1627 are CLOSED - this
 * endpoint is the whole historical archive, not the live market. Everything
 * about this adapter's cost profile follows from that single fact: the intake
 * is filtered to ACTIVE before anything else happens, which is why enriching
 * every survivor with a second request is cheap and why liveness checking does
 * not turn into 1645 HEAD requests at somebody else's server.
 */

export const MANFRED_BASE_URL = 'https://www.getmanfred.com';

/**
 * Manfred's own timeout, bigger than the shared board default.
 *
 * MEASURED, not guessed: the offers endpoint answers ~2.3 MB in ~9.6 s and the
 * sitemap ~289 KB in ~8.1 s from this connection. With the shared 15 s default
 * the whole source failed with "request timed out after 15000ms" and the run
 * reported "1 of 5 source queries failed" -which is exactly the "no coge bien
 * las fuentes" the user saw. The other four boards answer in well under a
 * second, so they keep the shared default.
 */
export const MANFRED_TIMEOUT_MS = 45_000;

/**
 * The offers list. `lang=ES` is not a preference - it is the parameter that
 * makes the endpoint answer at all.
 */
export const MANFRED_OFFERS_URL = `${MANFRED_BASE_URL}/api/v2/public/offers?lang=ES`;

/**
 * WHERE A MANFRED APPLY LINK COMES FROM.
 *
 * Read this before touching the URL handling, because it is the part of this
 * adapter most likely to be "simplified" into a defect.
 *
 * Neither the list payload nor the detail payload contains the posting's public
 * address. Every field that looks like it might - `id`, `slug` - is an
 * ingredient, not an address, and `domain/job.ts` states the rule plainly: a
 * job's URL is the source payload's own URL field, never something derived from
 * the id, the title or the company.
 *
 * The obvious move is to build `/ofertas-empleo/{id}-{slug}` and ship it. That
 * exact string returns HTTP 404. This project has already shipped fabricated
 * URLs once - thirteen "Aplicar" buttons pointing at addresses assembled from
 * the job title, all 403 - so a guessed pattern that happens to look right is
 * precisely the failure mode to refuse.
 *
 * The site publishes the answer. `robots.txt` advertises `sitemap-offers.xml`,
 * a machine-readable index whose entire content is the public URL of every
 * offer. That is a payload with a URL field, so using it obeys the domain rule
 * rather than working around it. Measured on 2026-09-10: 1645 `<loc>` entries
 * for 1645 offers, and all 18 ACTIVE offers' addresses returned HTTP 200.
 *
 * An offer the sitemap does not list is SKIPPED. Not repaired, not guessed.
 */
export const MANFRED_SITEMAP_URL = `${MANFRED_BASE_URL}/sitemap-offers.xml`;

export function manfredDetailUrl(offerId: string): string {
  return `${MANFRED_BASE_URL}/api/v2/public/offers/${encodeURIComponent(offerId)}?lang=ES`;
}

/**
 * The only offers the pipeline may surface.
 *
 * A CLOSED offer is not a vacancy. Keeping them would bury 18 real openings
 * under 1627 dead ones and spend a liveness request on each.
 */
export const MANFRED_ACTIVE_STATUS = 'ACTIVE';

/**
 * Currencies whose figures may be written into `salaryMin`/`salaryMax`.
 *
 * `Job` has no currency field, so a range in any other currency would be
 * rendered beside euro ranges and read as euros. Observed on 2026-09-10:
 * 1640 offers in `€`, plus four in `US$`, `MXN$` and `£`. Those four report no
 * salary rather than a misleading one.
 *
 * `' €'` really does occur, with a leading space. Trimmed before comparison.
 */
export const MANFRED_DISPLAYABLE_CURRENCIES: ReadonlySet<string> = new Set(['€', 'EUR']);

/**
 * How many offers may be enriched with a second request in one run.
 *
 * Sized against reality rather than guessed: 18 offers were ACTIVE when this
 * was written, so the bound is generous today and still refuses to become a
 * thousand-request sweep if Manfred ever publishes its whole archive as live.
 * Exceeding it is not an error - the extra offers ship with their list-level
 * description, which is degraded but honest.
 */
export const MANFRED_MAX_DETAIL_FETCHES = 80;

/** Free endpoint, personal job search. Small on purpose. */
export const MANFRED_CONCURRENCY = 4;
