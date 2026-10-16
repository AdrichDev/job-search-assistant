import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { createFixtureJobSource } from '../../src/adapters/fixture/fixture-job-source.js';
import { createNewsletterJobSource } from '../../src/adapters/newsletter/newsletter-job-source.js';
import { parseSourceSelection, type SelectableSourceId } from '../../src/cli/source-selection.js';
import { DEFAULT_FIXTURE_PATH } from '../../src/config/paths.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { DEFAULT_SEARCH_PLAN } from '../../src/config/search-plan.js';
import { auditQueueLinks, describeLinkProblems } from '../../src/domain/link-provenance.js';
import { countSampleDataEntries } from '../../src/domain/sample-data.js';
import { createJob } from '../../src/domain/job.js';
import type { JobSource } from '../../src/ports/job-source.js';
import type { JobQueue } from '../../src/ports/queue-writer.js';
import { silentLogger } from '../helpers/silent-logger.js';

/**
 * THE BLIND SPOT THIS FILE CLOSES.
 *
 * `e2e/specs/link-integrity.spec.ts` validates the queue THE TEST ITSELF SEEDS.
 * It stayed green for the whole life of this defect, because a hand-written
 * fixture of good links is always a fixture of good links - no matter what the
 * pipeline is doing that morning. Meanwhile the documented command,
 * `npm start -- --source=all`, was putting `example-board.test` addresses at
 * positions #1 and #3 of the user's real queue.
 *
 * So the rules are run here against a queue this test did NOT write: real
 * adapters, real `buildJobQueue`, real dedupe/score/filter/order, real
 * `--source` parsing. The only thing stubbed is the network, because the
 * standing rule is that no test may reach a job site - and a check that needs
 * the internet is a check that gets skipped.
 *
 * WHY HERE AND NOT IN THE E2E SUITE:
 *
 *   - The defect is in the PIPELINE, so the check belongs next to the pipeline,
 *     where it runs in `npm test` in two seconds instead of behind a Next build
 *     and a browser.
 *   - The E2E suite must seed a queue to control the page it renders. That is
 *     the right design for a UI test and it is exactly what makes it structurally
 *     incapable of noticing what the pipeline produced.
 *   - The CLI additionally audits its own output on every real run (see
 *     `renderLinkAudit` in `cli/render-table.ts`), so the user is told at the
 *     moment it happens rather than by a suite months later.
 */

const NOW = new Date('2026-09-08T09:00:00.000Z');

/** An offline stand-in for one of the real, network-backed providers. */
function stubSource(id: string, urls: readonly string[]): JobSource {
  return {
    id,
    async fetchJobs() {
      return urls.map((url, index) =>
        createJob({
          sourceId: id,
          externalId: `${id}-${index}`,
          title: `Junior Software Engineer ${id} ${index}`,
          company: `Employer ${id} ${index}`,
          location: 'Madrid, Spain',
          description:
            'Desarrollo de software con JavaScript y TypeScript. Perfil junior bienvenido.',
          url,
          postedAt: NOW,
        }),
      );
    },
  };
}

async function runPipeline(sources: readonly JobSource[]): Promise<JobQueue> {
  return buildJobQueue(
    { queries: DEFAULT_SEARCH_PLAN, candidateName: 'Alex Example' },
    {
      sources,
      scoringConfig: DEFAULT_SCORING_CONFIG,
      juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
      logger: silentLogger,
      now: () => NOW,
    },
  );
}

/**
 * The composition the CLI performs, minus the network.
 *
 * `fixture` is wired to the REAL adapter reading the REAL committed catalogue,
 * because that is the thing that leaked. Everything else is an offline stub
 * returning addresses of the shape those providers actually return.
 */
function sourcesFor(ids: readonly SelectableSourceId[]): readonly JobSource[] {
  const factories: Readonly<Record<SelectableSourceId, () => JobSource>> = {
    fixture: () => createFixtureJobSource({ filePath: DEFAULT_FIXTURE_PATH, now: () => NOW }),
    greenhouse: () =>
      stubSource('greenhouse', ['https://job-boards.greenhouse.io/factorial/jobs/6633404003']),
    lever: () =>
      stubSource('lever', ['https://jobs.lever.co/acme/1f0c7b2e-4a55-49f8-9c31-2b3d4e5f6a70']),
    ashby: () => stubSource('ashby', ['https://jobs.ashbyhq.com/acme/8a2b1c3d-4e5f-6071-8293-a4b5c6d7e8f9']),

    /*
     * The four sources added in this change.
     *
     * Every address below is a REAL one, copied out of the live payloads (or,
     * for Manfred, out of the published sitemap) on 2026-09-10 and confirmed
     * HTTP 200 by curl. They are here precisely because two of these providers
     * do not put an apply URL in the job payload at all, which is the exact
     * situation that produced this project's fabricated-link defect.
     */
    manfred: () =>
      stubSource('manfred', [
        // From `sitemap-offers.xml`, not assembled from the id and slug: the
        // dash form `/ofertas-empleo/8464-telnesstech-...` returns 404.
        'https://www.getmanfred.com/ofertas-empleo/8464/telnesstech-senior-software-engineer-us-eastern-time-ago26',
      ]),
    smartrecruiters: () =>
      stubSource('smartrecruiters', [
        // The detail payload's own `postingUrl`.
        'https://jobs.smartrecruiters.com/Devoteam/744000148470573-big-data-administrator-100-remoto-',
      ]),
    landingjobs: () =>
      stubSource('landingjobs', [
        'https://landing.jobs/at/damia-group-portugal/principal-cloud-security-engineer',
      ]),
    arbeitnow: () =>
      stubSource('arbeitnow', [
        'https://www.arbeitnow.com/jobs/companies/jessyworks/datev-techniker-operations-manager-remote-vollzeit-teilzeit-munich-18836',
      ]),

    newsletter: () =>
      stubSource('newsletter', [
        'https://careers.idealista.com/jobs/8103848-android-product-engineer',
      ]),
  };

  return ids.map((id) => factories[id]());
}

describe('link provenance of a PIPELINE-PRODUCED queue', () => {
  it('FAILS on a queue the pipeline built from the sample catalogue', async () => {
    /*
     * The proof that the check can go red - run over real pipeline output
     * rather than over a fixture written to be broken.
     *
     * `data/sample-jobs.json` is committed demo data whose every URL is on
     * `example-board.test`, a reserved TLD that does not resolve. Those rows
     * came out of `createFixtureJobSource` -> `createJob` -> dedupe -> scoring ->
     * both filters -> `orderByRecency`, exactly as they did in the user's run.
     */
    const queue = await runPipeline(sourcesFor(['fixture']));

    expect(queue.jobs.length).toBeGreaterThan(0);

    const problems = auditQueueLinks(queue);

    expect(problems.length).toBe(queue.jobs.length);
    expect(problems.every((problem) => problem.rule === 'placeholder-host')).toBe(true);
    expect(describeLinkProblems(problems)).toContain('example-board.test');
  });

  it('PASSES on a queue the pipeline built from real source addresses', async () => {
    const queue = await runPipeline(sourcesFor(['greenhouse', 'lever', 'ashby', 'newsletter']));

    expect(queue.jobs.length).toBeGreaterThan(0);

    const problems = auditQueueLinks(queue);
    expect(problems, describeLinkProblems(problems)).toHaveLength(0);
  });

  it('PASSES on the four sources added in this change', async () => {
    /*
     * Called out separately from the `all` case below because two of these
     * providers publish no apply URL in the job payload:
     *
     *   manfred          - the address exists only in `sitemap-offers.xml`
     *   smartrecruiters  - the address exists only on the per-posting detail
     *                      endpoint, as `postingUrl`
     *
     * Both are therefore one shortcut away from shipping an address assembled
     * from an id, which is the shape of the thirteen dead "Aplicar" buttons
     * this suite was written after. The audit's `title-derived` rule is what
     * would catch that, and this is where it gets pointed at them.
     */
    const queue = await runPipeline(
      sourcesFor(['manfred', 'smartrecruiters', 'landingjobs', 'arbeitnow']),
    );

    expect(queue.jobs.length).toBe(4);
    expect(countSampleDataEntries(queue.jobs)).toBe(0);

    const problems = auditQueueLinks(queue);
    expect(problems, describeLinkProblems(problems)).toHaveLength(0);

    // Every surfaced address traces back to a source ref, which is what
    // "provenance" means here: no URL appears that no source reported.
    for (const job of queue.jobs) {
      expect(job.sources.map((ref) => ref.url)).toContain(job.url);
    }
  });

  it('CANNOT catch a fabricated Manfred URL, and that is why the adapter never builds one', async () => {
    /*
     * A LIMIT OF THIS AUDIT, pinned deliberately so nobody relies on protection
     * that is not there.
     *
     * `/ofertas-empleo/{id}-{slug}` - a dash where the published sitemap has a
     * slash - is the address a reasonable person assembles from the two fields
     * Manfred hands over. It returns HTTP 404 on the live site.
     *
     * The audit passes it. It has to: `isTitleDerived` only fires when the URL
     * carries NO identifier of its own, and this one carries `8464`. That is
     * the same tolerance that (correctly) lets a real Greenhouse URL through
     * when it happens to contain the job title for SEO.
     *
     * So the audit is not, and cannot be, the thing standing between this
     * candidate and 1645 dead apply buttons. That job belongs entirely to
     * `manfred-job-source.ts`, which refuses to build an address at all and
     * skips any offer the sitemap does not list - see
     * `tests/adapters/manfred/manfred-job-source.test.ts`.
     *
     * If this test ever goes red because the audit got smarter, delete it and
     * celebrate. Until then it stops someone reading a green audit as proof.
     */
    const queue = await runPipeline([
      stubSource('manfred', [
        'https://www.getmanfred.com/ofertas-empleo/8464-telnesstech-senior-software-engineer-us-eastern-time-ago26',
      ]),
    ]);

    expect(auditQueueLinks(queue)).toHaveLength(0);
  });

  /*
   * THE REGRESSION TEST FOR THE USER'S ACTUAL COMMAND.
   *
   * Not "a queue built from the sources I chose for this test" - the sources
   * `--source=all` itself resolves to, wired through the same factory table the
   * CLI uses. Before the fix, `all` included `fixture`, this built the same
   * queue the user saw, and both assertions below failed.
   */
  it('produces no sample data and no dead links for --source=all', async () => {
    const selected = parseSourceSelection('all');
    const queue = await runPipeline(sourcesFor(selected));

    expect(queue.jobs.length).toBeGreaterThan(0);
    expect(countSampleDataEntries(queue.jobs)).toBe(0);

    const problems = auditQueueLinks(queue);
    expect(problems, describeLinkProblems(problems)).toHaveLength(0);
  });

  it('still audits the sample catalogue when the user asks for it by name', async () => {
    // `--source=fixture` remains legal and remains fully broken-by-design. The
    // audit does not go quiet just because the demo was requested; the CLI
    // banner is what tells the user it is a demo.
    const queue = await runPipeline(sourcesFor(parseSourceSelection('fixture')));

    expect(countSampleDataEntries(queue.jobs)).toBe(queue.jobs.length);
    expect(auditQueueLinks(queue).length).toBeGreaterThan(0);
  });
});

describe('link provenance of a queue built from a real saved newsletter', () => {
  let directory: string;

  const DIGEST = [
    '🇪🇸 Empezamos España y resto de Europa:',
    '1. 🚨 *Empieza las novedades Factorial, que busca a un GTM Engineer: https://juniorjobs.short.gy/2sxqtb*',
    '2. 🚨🧑‍💻 *Idealista necesita encontrar a un Android Product Engineer, 100% en remoto: https://juniorjobs.short.gy/Ha5kML*',
    '3. 🚨 *Red Points busca a un Backend Developer: https://juniorjobs.short.gy/nhamUo*',
    '',
    'juniorjobs.short.gy',
  ].join('\n');

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jq-provenance-'));
    await writeFile(join(directory, 'newsletter-2026-09-06.txt'), DIGEST, 'utf8');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps the sender addresses clean when nothing resolves', async () => {
    // The offline path: the resolver could follow nothing, so every posting
    // carries the shortener the newsletter wrote. That is second best and it is
    // honest - the link redirects. The audit must not flag it.
    const queue = await runPipeline([
      createNewsletterJobSource({
        directory,
        logger: silentLogger,
        now: () => NOW,
      }),
    ]);

    expect(queue.jobs.length).toBeGreaterThan(0);
    expect(auditQueueLinks(queue)).toHaveLength(0);
    expect(countSampleDataEntries(queue.jobs)).toBe(0);
  });

  it('keeps the resolved employer addresses clean too', async () => {
    const destinations: Readonly<Record<string, string>> = {
      'https://juniorjobs.short.gy/2sxqtb':
        'https://job-boards.greenhouse.io/factorial/jobs/6633404003',
      'https://juniorjobs.short.gy/Ha5kML':
        'https://careers.idealista.com/jobs/8103848-android-product-engineer',
      'https://juniorjobs.short.gy/nhamUo':
        'https://jobs.smartrecruiters.com/RedPoints1/744000147215471-backend-developer',
    };

    const queue = await runPipeline([
      createNewsletterJobSource({
        directory,
        logger: silentLogger,
        now: () => NOW,
        linkResolver: {
          async resolve(urls) {
            return new Map(
              urls.map((url) => [
                url,
                {
                  originalUrl: url,
                  finalUrl: destinations[url] ?? url,
                  resolved: destinations[url] !== undefined,
                  status: 200,
                  error: null,
                },
              ]),
            );
          },
        },
      }),
    ]);

    expect(queue.jobs.length).toBeGreaterThan(0);
    expect(queue.jobs.every((job) => !job.url.includes('short.gy'))).toBe(true);
    expect(auditQueueLinks(queue)).toHaveLength(0);
  });
});
