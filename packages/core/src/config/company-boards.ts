import type { BoardLocationFilter } from '../adapters/boards/board-location.js';

/**
 * WHICH COMPANIES THIS PIPELINE CAN SEE.
 *
 * Read this before adding a source: Greenhouse, Lever and Ashby are NOT search
 * engines. There is no "find junior React jobs in Madrid" endpoint. Each one
 * only answers "what is open at THIS company", so the pipeline's coverage of
 * them is not a property of the adapter code at all - it is a property of this
 * list. An empty list means three working adapters that find nothing.
 *
 * That is why the list is typed configuration with provenance rather than a
 * bare string array: a slug nobody ever checked looks exactly like a slug that
 * works, right up until it silently contributes zero postings forever.
 *
 * HOW TO ADD A COMPANY
 * --------------------
 * 1. Find the company's board and note which ATS it uses. The URL gives it away:
 *      job-boards.greenhouse.io/<slug>          -> provider 'greenhouse'
 *      jobs.lever.co/<slug>                     -> provider 'lever'
 *      jobs.ashbyhq.com/<slug>                  -> provider 'ashby'
 *      jobs.smartrecruiters.com/<slug>          -> provider 'smartrecruiters'
 * 2. Probe it. Companies move ATS and slugs vary, so try every provider:
 *      npm run verify:boards -- --probe acme acme-es grupoacme
 * 3. Add the entry below with the date you checked and BOTH counts you saw.
 *
 * ## THE BAR: ALL THREE, NOT ONE
 *
 * Every slug here costs at least one HTTP request on every single run, forever.
 * So a slug is committed only when it passes all three of these:
 *
 *   1. REACHABLE   - the board answers.
 *   2. SPAIN       - it has openings located in Spain    (`spainOpeningsAtVerification`).
 *   3. SOFTWARE    - at least one of them is software    (`softwareOpeningsAtVerification`).
 *
 * `npm run verify:boards` checks all three and prints which bar each failure
 * hit. Do not add a slug you have not run it against. Both counts below are
 * required fields precisely so that "I checked" cannot be claimed without a
 * number attached - a slug nobody ever measured looks exactly like a slug that
 * works, right up until it silently contributes zero postings forever.
 *
 * ### Why bar 1 is not bar 2 (the SmartRecruiters trap)
 *
 * On Greenhouse, Lever and Ashby a wrong slug returns 404, so "does it answer?"
 * and "does this company exist here?" are the same question. On SmartRecruiters
 * they are not: an unknown company answers **HTTP 200 with `totalFound: 0`**.
 *
 * `Telefonica`, `Glovo`, `Cabify`, `Santander`, `Indra`, `Inditex`, `Capgemini`
 * and twenty more all returned 200 while being nothing at all. Committing on
 * the status code alone would have added dozens of requests per run, forever,
 * for zero postings - and nothing would ever have complained.
 *
 * ### Why bar 2 is not bar 3 (the staffing-firm trap)
 *
 * `Sixt` (35 Spanish openings), `Accor` (15), `Thales` (2) and `Eurofirms` (1)
 * all cleared bar 2 and were REJECTED on bar 3 - they were car rental agents,
 * hotel receptionists and a talent programme from 2019. On the 2026-09-10 sweep
 * `sumup` (23 Spanish openings), `remote` (6), `gympass` (4), `mirakl` (2),
 * `getyourguide` (1) and `agicap` (1) failed the same way.
 *
 * Bar 3 is judged by `domain/board-verdict.ts`, which runs the pipeline's OWN
 * `scoreSoftwareRelevance` gate over the postings rather than reading titles by
 * eye. That matters in both directions: eyeballing would have admitted the
 * staffing firms, and it would have REJECTED the Spanish consultancy that
 * titles a role "Consultor/a Junior" and names Dynamics 365 only in the body.
 * A board whose entire Spanish presence is filtered out downstream is still a
 * request per run that can never pay for itself.
 *
 * ## WHAT THE 2026-09-10 SWEEP LEARNED (read before probing the same names)
 *
 * ~300 candidate names were probed across all four providers, ~1200 requests.
 * The result was lopsided enough to be worth writing down, because it saves the
 * next person the same sweep:
 *
 *   Spanish IT consultancies are NOT ON THESE PLATFORMS. Not one.
 *
 * Every Microsoft-partner consultancy tried - Seidor, Ibermatica, Ayesa,
 * Sothis, Aitana, Prodware, Hiberus, Trevenque, Altim, Tecnativa, Softeng,
 * Plain Concepts, Encamina, Bilbomatica, Intelequia, Sivsa, Fullstep, Zerintia
 * and their `-es` / `grupo-` variants - returned 404 on Greenhouse, Lever and
 * Ashby and `totalFound: 0` on SmartRecruiters. So did NTT Data, everis,
 * Minsait, Indra, Accenture, Capgemini, Sopra Steria, Inetum, VASS, Izertis,
 * Babel, Paradigma, Knowmad Mood, Plexus, Emergya, Alten, Stratesys and
 * Deloitte. So did the international Dynamics shops - Avanade, Delaware, HSO,
 * Columbus, Fellowmind, Innofactor, Hitachi Solutions - and the corporate tech
 * arms: CaixaBank, Santander, BBVA, Telefonica, Mapfre, Repsol, Iberdrola,
 * Naturgy, El Corte Ingles, Mercadona, Inditex, Cepsa.
 *
 * These four ATS are used by venture-backed product companies. Spanish
 * consultancies publish on their own careers pages, InfoJobs and Tecnoempleo,
 * none of which has a documented JSON API. Widening THIS list cannot reach
 * them; that needs a different source, not more slugs.
 */

export type BoardProviderId = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters';

export const BOARD_PROVIDER_IDS: readonly BoardProviderId[] = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
];

export interface CompanyBoard {
  /** The slug exactly as the ATS URL spells it. Used unescaped in a URL path. */
  readonly slug: string;
  readonly provider: BoardProviderId;
  /**
   * Shown to the candidate, and used as the company name for Lever and Ashby -
   * neither of those APIs returns one.
   */
  readonly displayName: string;
  /** ISO date on which this slug was last observed answering HTTP 200. */
  readonly verifiedOn: string;
  /**
   * Spanish openings counted on the board at verification time (BAR 2).
   *
   * Not a promise about today - it is evidence that this board is worth a
   * request at all. A board that has drifted to 0 for months is a candidate
   * for deletion, and this number is what makes that visible.
   */
  readonly spainOpeningsAtVerification: number;
  /**
   * How many of those Spanish openings the software gate accepted (BAR 3).
   *
   * A separate number from the one above because they fail separately, and the
   * difference is the entire lesson of `Sixt`: 35 Spanish openings, none of
   * them software, every one discarded by `build-job-queue.ts` one layer later.
   * Recording only the first number makes that board look like an asset.
   *
   * Required, and required to be positive, so bar 3 cannot be skipped by
   * someone adding a slug in a hurry.
   */
  readonly softwareOpeningsAtVerification: number;
}

/**
 * Every entry re-verified 2026-09-10 against the live APIs with
 * `npm run verify:boards`. Both counts are what that run actually printed.
 *
 * Ordered by Spanish opening count within each provider, so the boards that
 * carry the list sit at the top and the marginal ones are visible as marginal.
 */
export const COMPANY_BOARDS: readonly CompanyBoard[] = [
  /*
   * --- Greenhouse ----------------------------------------------------------
   *
   * `jampp` was REMOVED on 2026-09-10: it still answers, but its Spanish
   * openings have drifted to 0 since it was added on 2026-09-08. Deleting it
   * cannot change the queue - it had nothing to contribute - and it saves a
   * request per run. This is the deletion the `spainOpeningsAtVerification`
   * doc comment exists to make possible.
   */
  { slug: 'feverup', provider: 'greenhouse', displayName: 'Fever', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 238, softwareOpeningsAtVerification: 66 },
  { slug: 'scopely', provider: 'greenhouse', displayName: 'Scopely', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 73, softwareOpeningsAtVerification: 29 },
  { slug: 'ebury', provider: 'greenhouse', displayName: 'Ebury', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 55, softwareOpeningsAtVerification: 31 },
  { slug: 'elastic', provider: 'greenhouse', displayName: 'Elastic', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 33, softwareOpeningsAtVerification: 17 },
  { slug: 'n26', provider: 'greenhouse', displayName: 'N26', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 32, softwareOpeningsAtVerification: 23 },
  { slug: 'cabify', provider: 'greenhouse', displayName: 'Cabify', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 25, softwareOpeningsAtVerification: 6 },
  { slug: 'datadog', provider: 'greenhouse', displayName: 'Datadog', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 17, softwareOpeningsAtVerification: 17 },
  { slug: 'grafanalabs', provider: 'greenhouse', displayName: 'Grafana Labs', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 13, softwareOpeningsAtVerification: 12 },
  { slug: 'freenow', provider: 'greenhouse', displayName: 'FREENOW', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 13, softwareOpeningsAtVerification: 6 },
  { slug: 'typeform', provider: 'greenhouse', displayName: 'Typeform', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 8, softwareOpeningsAtVerification: 3 },
  { slug: 'wallapop', provider: 'greenhouse', displayName: 'Wallapop', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 7, softwareOpeningsAtVerification: 4 },
  { slug: 'mongodb', provider: 'greenhouse', displayName: 'MongoDB', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 5, softwareOpeningsAtVerification: 5 },
  { slug: 'newrelic', provider: 'greenhouse', displayName: 'New Relic', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 5, softwareOpeningsAtVerification: 5 },
  { slug: 'bitpanda', provider: 'greenhouse', displayName: 'Bitpanda', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 5, softwareOpeningsAtVerification: 2 },
  { slug: 'gitlab', provider: 'greenhouse', displayName: 'GitLab', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 5, softwareOpeningsAtVerification: 2 },
  { slug: 'stripe', provider: 'greenhouse', displayName: 'Stripe', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 4, softwareOpeningsAtVerification: 2 },
  { slug: 'twilio', provider: 'greenhouse', displayName: 'Twilio', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 3, softwareOpeningsAtVerification: 2 },
  { slug: 'adyen', provider: 'greenhouse', displayName: 'Adyen', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 3, softwareOpeningsAtVerification: 2 },
  { slug: 'clarityai', provider: 'greenhouse', displayName: 'Clarity AI', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 2, softwareOpeningsAtVerification: 1 },
  { slug: 'dataiku', provider: 'greenhouse', displayName: 'Dataiku', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 1, softwareOpeningsAtVerification: 1 },

  // --- Lever ----------------------------------------------------------------
  { slug: 'aircall', provider: 'lever', displayName: 'Aircall', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 20, softwareOpeningsAtVerification: 15 },
  { slug: 'veepee', provider: 'lever', displayName: 'Veepee', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 15, softwareOpeningsAtVerification: 3 },
  { slug: 'jobandtalent', provider: 'lever', displayName: 'Job&Talent', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 15, softwareOpeningsAtVerification: 2 },
  { slug: 'lodgify', provider: 'lever', displayName: 'Lodgify', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 13, softwareOpeningsAtVerification: 4 },
  { slug: 'qonto', provider: 'lever', displayName: 'Qonto', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 10, softwareOpeningsAtVerification: 8 },
  { slug: 'deliverect', provider: 'lever', displayName: 'Deliverect', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 9, softwareOpeningsAtVerification: 2 },
  { slug: 'contentsquare', provider: 'lever', displayName: 'Contentsquare', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 6, softwareOpeningsAtVerification: 2 },
  { slug: 'binance', provider: 'lever', displayName: 'Binance', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 1, softwareOpeningsAtVerification: 1 },

  /*
   * --- Ashby ----------------------------------------------------------------
   *
   * `cohere` was REMOVED on 2026-09-10: 1 Spanish opening, 0 of them software.
   * It failed bar 3, so `build-job-queue.ts` was already discarding its only
   * posting - removing it changes no output and saves a request per run.
   *
   * `belvo` PASSED all three bars and was still rejected, which is the one
   * judgement call on this list. Its single Spanish "opening" is an evergreen
   * `CV for Future Opportunities` talent-pool entry: it scores as software, it
   * will never close, and committing it buys a permanent queue resident that is
   * not a vacancy. Recorded here rather than silently dropped so the next
   * person probing Belvo knows it was checked, not missed.
   */
  { slug: 'preply', provider: 'ashby', displayName: 'Preply', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 48, softwareOpeningsAtVerification: 26 },
  { slug: 'elevenlabs', provider: 'ashby', displayName: 'ElevenLabs', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 28, softwareOpeningsAtVerification: 20 },
  { slug: 'alan', provider: 'ashby', displayName: 'Alan', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 24, softwareOpeningsAtVerification: 17 },
  { slug: 'n8n', provider: 'ashby', displayName: 'n8n', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 20, softwareOpeningsAtVerification: 13 },
  { slug: 'docplanner', provider: 'ashby', displayName: 'Docplanner', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 20, softwareOpeningsAtVerification: 11 },
  { slug: 'docker', provider: 'ashby', displayName: 'Docker', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 12, softwareOpeningsAtVerification: 9 },
  { slug: 'pleo', provider: 'ashby', displayName: 'Pleo', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 8, softwareOpeningsAtVerification: 3 },
  { slug: 'legora', provider: 'ashby', displayName: 'Legora', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 4, softwareOpeningsAtVerification: 1 },
  { slug: 'sierra', provider: 'ashby', displayName: 'Sierra', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 4, softwareOpeningsAtVerification: 1 },
  { slug: 'backmarket', provider: 'ashby', displayName: 'Back Market', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 3, softwareOpeningsAtVerification: 3 },
  { slug: 'harvey', provider: 'ashby', displayName: 'Harvey', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 2, softwareOpeningsAtVerification: 1 },
  { slug: 'sardine', provider: 'ashby', displayName: 'Sardine', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 1, softwareOpeningsAtVerification: 1 },
  { slug: 'capchase', provider: 'ashby', displayName: 'Capchase', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 1, softwareOpeningsAtVerification: 1 },

  /*
   * --- SmartRecruiters -----------------------------------------------------
   *
   * Verified with
   *   GET /v1/companies/<slug>/postings?country=es&limit=100
   * reading the CONTENT, not the status code - see the header note.
   *
   * Still only four. The 2026-09-10 sweep added ~300 more names across this
   * provider and every single one answered 200 with nothing in it. If a probe
   * ever reports a fifth, read the count twice before believing it.
   *
   * SmartRecruiters spells these `Devoteam`, `DeliveryHero`, `BoschGroup` and
   * `NielsenIQ`, but its company path is case-INSENSITIVE - all four lowercase
   * forms were confirmed returning the identical `totalFound` on 2026-09-10. So
   * they are stored lowercase like every other slug here, and the existing
   * "safe in a URL path unescaped" rule keeps applying unchanged. The canonical
   * casing still reaches the candidate: it is part of the `postingUrl` the API
   * reports, which is the address that gets used.
   *
   * These four are also the only boards here that cost a SECOND request per
   * surviving posting (`smartrecruiters-board.ts` has to ask for the apply URL).
   * That is why a fifth one needs more justification than a Greenhouse slug.
   */
  { slug: 'deliveryhero', provider: 'smartrecruiters', displayName: 'Delivery Hero', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 85, softwareOpeningsAtVerification: 14 },
  { slug: 'boschgroup', provider: 'smartrecruiters', displayName: 'Bosch', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 66, softwareOpeningsAtVerification: 10 },
  { slug: 'devoteam', provider: 'smartrecruiters', displayName: 'Devoteam', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 65, softwareOpeningsAtVerification: 49 },
  { slug: 'nielseniq', provider: 'smartrecruiters', displayName: 'NielsenIQ', verifiedOn: '2026-09-10', spainOpeningsAtVerification: 10, softwareOpeningsAtVerification: 7 },
];

/** The boards belonging to one provider. Unknown providers yield nothing. */
export function companiesFor(provider: BoardProviderId): readonly CompanyBoard[] {
  return COMPANY_BOARDS.filter((entry) => entry.provider === provider);
}

/**
 * Which locations are worth fetching off a company board.
 *
 * City terms come first for readability only - `matchesBoardLocation` treats
 * both lists the same way. Spain-wide terms are included because a large share
 * of the reachable roles are published as "Spain (Remote)" with no city at all,
 * and a Madrid-only filter would throw every one of them away.
 *
 * `es` is Lever's ISO country code (`Madrid HQ, ES`). It is only ever matched
 * against a LOCATION string, and only on token boundaries, so it cannot fire
 * inside `Leeds` or `Buenos Aires`.
 */
export const DEFAULT_BOARD_LOCATION_FILTER: BoardLocationFilter = {
  cityTerms: [
    'madrid',
    'barcelona',
    'valencia',
    'sevilla',
    'malaga',
    'bilbao',
    'zaragoza',
    'alicante',
    'murcia',
    'granada',
    'valladolid',
    'santander',
    'pamplona',
    'donostia',
    'coruna',
    'vigo',
  ],
  countryTerms: ['spain', 'espana', 'es'],
};
