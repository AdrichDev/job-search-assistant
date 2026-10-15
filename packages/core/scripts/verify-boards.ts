import { readFileSync } from 'node:fs';
import { consoleLogger } from '../src/adapters/logging/console-logger.js';
import { ashbyProvider, createAshbyJobSource } from '../src/adapters/boards/ashby-board.js';
import {
  createGreenhouseJobSource,
  greenhouseProvider,
} from '../src/adapters/boards/greenhouse-board.js';
import { createLeverJobSource, leverProvider } from '../src/adapters/boards/lever-board.js';
import {
  createSmartRecruitersJobSource,
  smartRecruitersProvider,
} from '../src/adapters/boards/smartrecruiters-board.js';
import type { BoardProvider } from '../src/adapters/boards/board-job-source.js';
import {
  DEFAULT_BOARD_TIMEOUT_MS,
  fetchBoardJson,
  mapWithConcurrency,
} from '../src/adapters/boards/board-http.js';
import { matchesBoardLocation } from '../src/adapters/boards/board-location.js';
import {
  BOARD_PROVIDER_IDS,
  COMPANY_BOARDS,
  DEFAULT_BOARD_LOCATION_FILTER,
  companiesFor,
  type BoardProviderId,
  type CompanyBoard,
} from '../src/config/company-boards.js';
import { DEFAULT_SCORING_CONFIG } from '../src/config/scoring-config.js';
import {
  judgeBoardVerdict,
  softwareOpenings,
  type BoardVerdict,
} from '../src/domain/board-verdict.js';
import type { JobSource, JobSourceQuery } from '../src/ports/job-source.js';

/**
 * Checks that a company board is real, answering, hiring in SPAIN, and hiring
 * for SOFTWARE - the three bars `domain/board-verdict.ts` defines.
 *
 * This is the tool `config/company-boards.ts` tells you to run before
 * committing a slug, and the one to run when a provider quietly stops
 * contributing. It is a SCRIPT and not a test on purpose: it hits the network,
 * so it must never run inside `npm test`.
 *
 *   npm run verify:boards
 *       Re-verify every configured board. This is the single command the
 *       README documents; it is what proves the committed list still earns its
 *       requests.
 *
 *   npm run verify:boards -- greenhouse acme acme-es
 *       Probe candidate slugs on ONE provider.
 *
 *   npm run verify:boards -- --probe seidor encamina "plain-concepts"
 *       Probe each name across ALL FOUR providers. Companies move ATS, so a
 *       name absent from Greenhouse is not a name that is absent.
 *
 *   npm run verify:boards -- --probe-file candidates.txt
 *       The same, reading one name per line (`#` starts a comment). This is how
 *       a large sweep is run without a 300-argument command line.
 *
 * A 404 means the company is not on that ATS. It does not mean the API is down:
 * every one of these endpoints was confirmed working when this was written.
 *
 * ## WHY PROBING IS TWO-STAGE
 *
 * Probing hundreds of names across four providers is ~4 requests per name. That
 * is already a lot to ask of someone else's free endpoint, so stage 1 asks each
 * board exactly ONCE and answers bars 1 and 2 from that single payload - no
 * per-posting hydration, no minting.
 *
 * Only the handful of boards that survive stage 1 go through the real
 * `JobSource` in stage 2, which is what pays SmartRecruiters' one-detail-request
 * -per-posting cost. Running stage 2 over every candidate would have turned a
 * one-off developer action into thousands of requests, most of them against
 * companies that are not on that ATS at all.
 */

const QUERY: JobSourceQuery = {
  what: '(verification sweep)',
  where: 'Madrid',
  maxDaysOld: 3650,
  resultsPerPage: 100,
  maxPages: 1,
};

/** Small on purpose. This is a maintenance tool aimed at free endpoints. */
const PROBE_CONCURRENCY = 4;
const RELEVANCE = DEFAULT_SCORING_CONFIG.softwareRelevance;

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function providerFor(provider: BoardProviderId): BoardProvider {
  switch (provider) {
    case 'greenhouse':
      return greenhouseProvider;
    case 'lever':
      return leverProvider;
    case 'ashby':
      return ashbyProvider;
    case 'smartrecruiters':
      return smartRecruitersProvider;
  }
}

function sourceFor(provider: BoardProviderId, companies: readonly CompanyBoard[]): JobSource {
  const options = { companies, logger: silent, concurrency: 1, timeoutMs: 20_000 };
  switch (provider) {
    case 'greenhouse':
      return createGreenhouseJobSource(options);
    case 'lever':
      return createLeverJobSource(options);
    case 'ashby':
      return createAshbyJobSource(options);
    case 'smartrecruiters':
      /*
       * Worth knowing when you read this tool's output for SmartRecruiters: an
       * unknown company answers HTTP 200 with `totalFound: 0`, so a bad slug
       * shows up as `no-spain-openings` rather than `unreachable`. Empty there
       * means "not on this ATS, or not hiring in Spain" - two different things
       * this API refuses to distinguish.
       */
      return createSmartRecruitersJobSource(options);
  }
}

interface Verdict {
  readonly provider: BoardProviderId;
  readonly slug: string;
  readonly spainOpenings: number;
  readonly softwareOpenings: number;
  readonly sampleTitles: readonly string[];
  readonly error: string | null;
  readonly verdict: BoardVerdict;
}

function candidate(provider: BoardProviderId, slug: string): CompanyBoard {
  return {
    slug,
    provider,
    displayName: slug,
    verifiedOn: new Date().toISOString().slice(0, 10),
    // Zero because this is a slug UNDER TEST: the counts are what the probe is
    // about to measure, not something the caller gets to assert up front.
    spainOpeningsAtVerification: 0,
    softwareOpeningsAtVerification: 0,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * STAGE 1: one request. Answers "is it there" and "is it hiring in Spain".
 *
 * Deliberately does NOT mint `Job`s. SmartRecruiters' list payload carries no
 * apply URL, so minting would either fail or invent an address - and neither
 * question being asked here needs one.
 */
async function countSpanishOpenings(
  provider: BoardProviderId,
  slug: string,
): Promise<{ spainOpenings: number; error: string | null }> {
  const board = providerFor(provider);
  const company = candidate(provider, slug);
  try {
    const payload = await fetchBoardJson(board.boardUrl(company), {
      timeoutMs: DEFAULT_BOARD_TIMEOUT_MS,
    });
    const postings = board.parseBoard(payload, { company, skip: () => undefined });
    const inSpain = postings.filter((posting) =>
      matchesBoardLocation(posting.locationCandidates, DEFAULT_BOARD_LOCATION_FILTER),
    );
    return { spainOpenings: inSpain.length, error: null };
  } catch (cause: unknown) {
    return { spainOpenings: 0, error: errorMessage(cause) };
  }
}

/**
 * STAGE 2: the real source, so bar 3 is judged on the same `Job` the pipeline
 * would surface - description included, which is where a Spanish consultancy
 * names Dynamics 365 while its title says only "Consultor/a".
 */
async function verify(company: CompanyBoard): Promise<Verdict> {
  const source = sourceFor(company.provider, [company]);
  try {
    const jobs = await source.fetchJobs(QUERY);
    const software = softwareOpenings(jobs, RELEVANCE);
    const probe = {
      error: null,
      spainOpenings: jobs.length,
      softwareOpenings: software.length,
    };
    return {
      provider: company.provider,
      slug: company.slug,
      ...probe,
      sampleTitles: software.slice(0, 3).map((job) => job.title),
      verdict: judgeBoardVerdict(probe),
    };
  } catch (cause: unknown) {
    const probe = { error: errorMessage(cause), spainOpenings: 0, softwareOpenings: 0 };
    return {
      provider: company.provider,
      slug: company.slug,
      ...probe,
      sampleTitles: [],
      verdict: judgeBoardVerdict(probe),
    };
  }
}

interface Target {
  readonly provider: BoardProviderId;
  readonly slug: string;
}

/**
 * Name-major, provider-minor.
 *
 * Not cosmetic: with four in flight over a list ordered this way, the four
 * requests in flight are almost always against four DIFFERENT hosts, so no
 * single ATS sees more than about one concurrent request from this sweep.
 */
function crossProduct(names: readonly string[]): readonly Target[] {
  return names.flatMap((slug) => BOARD_PROVIDER_IDS.map((provider) => ({ provider, slug })));
}

function readNames(path: string): readonly string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.split('#')[0]?.trim() ?? '')
    .filter((line) => line.length > 0);
}

function printVerdicts(verdicts: readonly Verdict[]): void {
  const by = (wanted: BoardVerdict): readonly Verdict[] =>
    verdicts.filter((entry) => entry.verdict === wanted);

  const passing = by('pass');
  console.log(`PASS - answering, hiring in Spain, hiring for software (${passing.length}):`);
  for (const entry of passing) {
    const sample = entry.sampleTitles.length > 0 ? `  e.g. ${entry.sampleTitles.join(' | ')}` : '';
    console.log(
      `  ${entry.provider.padEnd(15)} ${entry.slug.padEnd(28)} ` +
        `${String(entry.spainOpenings).padStart(3)} ES / ` +
        `${String(entry.softwareOpenings).padStart(3)} software${sample}`,
    );
  }

  const wrongKind = by('no-software-openings');
  if (wrongKind.length > 0) {
    console.log(
      `\nFAILED BAR 3 - hiring in Spain, but no software among it (${wrongKind.length}):`,
    );
    for (const entry of wrongKind) {
      console.log(
        `  ${entry.provider.padEnd(15)} ${entry.slug.padEnd(28)} ${entry.spainOpenings} ES opening(s), 0 software`,
      );
    }
  }

  const empty = by('no-spain-openings');
  if (empty.length > 0) {
    console.log(`\nFAILED BAR 2 - answered, but nothing in Spain (${empty.length}):`);
    for (const entry of empty) {
      console.log(`  ${entry.provider.padEnd(15)} ${entry.slug}`);
    }
  }

  const dead = by('unreachable');
  if (dead.length > 0) {
    console.log(`\nFAILED BAR 1 - unreachable (${dead.length}):`);
    for (const entry of dead) {
      console.log(`  ${entry.provider.padEnd(15)} ${entry.slug.padEnd(28)} ${entry.error ?? ''}`);
    }
  }
}

async function probe(names: readonly string[]): Promise<number> {
  const targets = crossProduct(names);
  consoleLogger.info(
    `stage 1: probing ${names.length} name(s) across ${BOARD_PROVIDER_IDS.length} providers ` +
      `= ${targets.length} request(s), ${PROBE_CONCURRENCY} in flight...\n`,
  );

  const stageOne = await mapWithConcurrency(targets, PROBE_CONCURRENCY, async (target) => ({
    target,
    ...(await countSpanishOpenings(target.provider, target.slug)),
  }));

  const survivors = stageOne.filter((entry) => entry.error === null && entry.spainOpenings > 0);
  const rejected = stageOne.filter((entry) => entry.error !== null || entry.spainOpenings === 0);

  consoleLogger.info(
    `stage 1 done: ${survivors.length} board(s) have Spanish openings; ` +
      `${rejected.length} did not. Confirming the survivors with the real source...\n`,
  );

  const verdicts = await mapWithConcurrency(
    survivors.map((entry) => candidate(entry.target.provider, entry.target.slug)),
    PROBE_CONCURRENCY,
    verify,
  );

  printVerdicts(verdicts);

  /*
   * Stage-1 rejects are summarised, not listed one by one. A four-provider
   * sweep of a hundred names produces ~390 of them and printing every line
   * would bury the handful of results a human has to act on.
   *
   * ONE GROUP IS WORTH NAMING, though: a Greenhouse, Lever or Ashby board that
   * ANSWERED and had no Spanish openings. On those three a wrong slug 404s, so
   * an answer proves the company really is on that ATS - it is simply not
   * hiring in Spain today. That is a different fact from "not there at all",
   * and it is the only reject worth revisiting later.
   *
   * SmartRecruiters is excluded from that list precisely because it cannot make
   * the distinction: every unknown company answers 200 with `totalFound: 0`, so
   * naming them would print the whole sweep back at the reader.
   */
  const unreachable = rejected.filter((entry) => entry.error !== null).length;
  const realButEmpty = rejected.filter(
    (entry) => entry.error === null && entry.target.provider !== 'smartrecruiters',
  );

  console.log(
    `\nStage-1 rejects (${rejected.length}): ` +
      `${unreachable} unreachable (not on that ATS), ` +
      `${rejected.length - unreachable} answered with no Spanish openings.`,
  );

  if (realButEmpty.length > 0) {
    console.log(
      `\n  Of those, ${realButEmpty.length} board(s) provably EXIST but have nothing in Spain:`,
    );
    for (const entry of realButEmpty) {
      console.log(`    ${entry.target.provider.padEnd(15)} ${entry.target.slug}`);
    }
  }
  console.log('');
  return 0;
}

async function verifyConfigured(companies: readonly CompanyBoard[]): Promise<number> {
  consoleLogger.info(`verifying ${companies.length} board(s)...\n`);

  // Bounded on purpose: this is a maintenance tool, not a hot path, and
  // politeness matters more than speed against someone else's free endpoint.
  const verdicts = await mapWithConcurrency(companies, 3, verify);
  printVerdicts(verdicts);
  console.log('');

  // Non-zero only for a hard failure: an empty board is information, not an
  // error, and a board that drifted to zero software is a decision for a human.
  return verdicts.some((entry) => entry.verdict === 'unreachable') ? 1 : 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [head, ...rest] = argv;

  if (head === '--probe') {
    if (rest.length === 0) {
      throw new Error('--probe needs at least one company name');
    }
    return probe(rest);
  }

  if (head === '--probe-file') {
    const [path] = rest;
    if (path === undefined) {
      throw new Error('--probe-file needs a path to a newline-separated list of names');
    }
    return probe(readNames(path));
  }

  if (head === undefined) {
    return verifyConfigured(COMPANY_BOARDS);
  }

  if (!BOARD_PROVIDER_IDS.includes(head as BoardProviderId)) {
    throw new Error(
      `unknown provider "${head}". Use one of: ${BOARD_PROVIDER_IDS.join(', ')}, ` +
        'or --probe / --probe-file to try every provider.',
    );
  }
  const typed = head as BoardProviderId;

  if (rest.length === 0) {
    return verifyConfigured(companiesFor(typed));
  }
  return verifyConfigured(rest.map((slug) => candidate(typed, slug)));
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    consoleLogger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
