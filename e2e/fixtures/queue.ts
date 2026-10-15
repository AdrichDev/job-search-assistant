/**
 * Deterministic queue files, in the exact on-disk shape the app reads.
 *
 * These are written as literal JSON rather than produced by running the
 * pipeline. That is on purpose: the pipeline is already covered by 585 unit
 * tests, and a browser suite that depends on it would fail for reasons that
 * have nothing to do with the browser. What is under test here is everything
 * BETWEEN the queue file and the human's eye.
 *
 * Nothing in this file may reference a real job board in a way the browser
 * could follow. Hosts below are chosen to look plausible in the DOM; the
 * browser context blocks every non-localhost request regardless.
 */

export interface QueueEntryFile {
  readonly rank: number;
  readonly id: string;
  readonly score: number;
  readonly cvVariant: 'frontend' | 'microsoft' | 'general';
  readonly requirements: {
    readonly yearsRequired: number | null;
    readonly senioritySignals: readonly {
      readonly term: string;
      readonly level: 'junior' | 'senior';
      readonly where: 'title' | 'description';
    }[];
    readonly matchedStack: readonly string[];
    readonly cvVariant: 'frontend' | 'microsoft' | 'general';
    readonly englishRequired: 'not_stated' | 'basic' | 'intermediate' | 'advanced';
    readonly workMode: 'onsite' | 'hybrid' | 'remote' | 'unknown';
  };
  readonly applicationStatus: string;
  readonly appliedAt: string | null;
  readonly outcomeUpdatedAt: string | null;
  readonly notes: string | null;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly url: string;
  readonly postedAt: string;
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly contractType: string | null;
  readonly sources: readonly {
    readonly sourceId: string;
    readonly externalId: string;
    readonly url: string;
  }[];
  readonly breakdown: readonly {
    readonly dimension: string;
    readonly value: number;
    readonly weight: number;
    readonly contribution: number;
    readonly reason: string;
  }[];
  /**
   * What the liveness check concluded, or `null`/absent when it never ran.
   *
   * Optional here, and that is itself part of what is under test: a queue file
   * written before liveness checking existed must still render. The reader
   * defaults the field to `null`, which means "not checked" and marks nothing.
   *
   * `gone` never appears in a real queue file - a posting that proved it was
   * gone is removed before the file is written - so the fixtures only ever
   * carry `alive`, `unverified` or nothing.
   */
  readonly liveness?: {
    readonly verdict: 'alive' | 'gone' | 'unverified';
    readonly status: number | null;
    readonly checkedAt: string;
    readonly error: string | null;
  } | null;
}

export interface SourceReportFile {
  readonly sourceId: string;
  readonly query: string;
  readonly status: 'ok' | 'failed';
  readonly fetched: number;
  readonly error?: string;
}

export interface QueueFile {
  readonly generatedAt: string;
  readonly candidate: string;
  readonly totalFetched: number;
  readonly totalUnique: number;
  readonly totalRelevant: number;
  readonly totalJuniorEligible: number;
  readonly duplicatesRemoved: number;
  readonly sourceReports: readonly SourceReportFile[];
  readonly excluded: readonly unknown[];
  readonly jobs: readonly QueueEntryFile[];
}

/** Frozen clock. Every relative age the UI prints is derived from this. */
export const GENERATED_AT = '2026-03-10T09:00:00.000Z';

/** One day before `GENERATED_AT`, so every card reads "Publicada hace 1 día". */
const POSTED_AT = '2026-03-09T09:00:00.000Z';

function breakdown(total: number): QueueEntryFile['breakdown'] {
  return [
    {
      dimension: 'seniorityFit',
      value: 0.8,
      weight: 0.34,
      contribution: Math.round(total * 0.5 * 10) / 10,
      reason: 'junior signal in title (junior)',
    },
    {
      dimension: 'stackMatch',
      value: 0.5,
      weight: 0.24,
      contribution: Math.round(total * 0.2 * 10) / 10,
      reason: 'frontend lane: react, typescript',
    },
    {
      dimension: 'locationFit',
      value: 0.9,
      weight: 0.18,
      contribution: Math.round(total * 0.15 * 10) / 10,
      reason: 'Madrid',
    },
    {
      dimension: 'languageFit',
      value: 0.7,
      weight: 0.14,
      contribution: Math.round(total * 0.1 * 10) / 10,
      reason: 'posting written in Spanish',
    },
    {
      dimension: 'recency',
      value: 0.97,
      weight: 0.1,
      contribution: Math.round(total * 0.05 * 10) / 10,
      reason: 'posted 1 day ago',
    },
  ];
}

interface EntrySeed {
  readonly rank: number;
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly cvVariant: 'frontend' | 'microsoft' | 'general';
  readonly url: string;
  readonly externalId: string;
  readonly sourceId: string;
  readonly score: number;
  readonly stack: readonly string[];
}

function entry(seed: EntrySeed): QueueEntryFile {
  return {
    rank: seed.rank,
    id: seed.id,
    score: seed.score,
    cvVariant: seed.cvVariant,
    requirements: {
      yearsRequired: null,
      senioritySignals: [{ term: 'junior', level: 'junior', where: 'title' }],
      matchedStack: seed.stack,
      cvVariant: seed.cvVariant,
      englishRequired: 'not_stated',
      workMode: 'hybrid',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    title: seed.title,
    company: seed.company,
    location: seed.location,
    url: seed.url,
    postedAt: POSTED_AT,
    salaryMin: 24000,
    salaryMax: 30000,
    contractType: 'permanent',
    sources: [{ sourceId: seed.sourceId, externalId: seed.externalId, url: seed.url }],
    breakdown: breakdown(seed.score),
  };
}

/**
 * The seeds, written once and reused by both the healthy and the fabricated
 * variants below. Same titles, same companies, same everything EXCEPT the URL -
 * which is the whole point of the comparison.
 */
const SEEDS: readonly Omit<EntrySeed, 'url'>[] = [
  {
    rank: 1,
    id: 'acme::junior frontend developer::madrid',
    title: 'Junior Frontend Developer',
    company: 'ACME Digital',
    location: 'Madrid',
    cvVariant: 'frontend',
    externalId: '4471203',
    sourceId: 'greenhouse',
    score: 61.4,
    stack: ['react', 'typescript'],
  },
  {
    rank: 2,
    id: 'kubo labs::desarrollador junior net::alcobendas',
    title: 'Desarrollador Junior .NET',
    company: 'Kubo Labs',
    location: 'Alcobendas',
    cvVariant: 'microsoft',
    externalId: 'a91f2c7e-4d0b-4a52-9f11-6c2b8d5e7a30',
    sourceId: 'lever',
    score: 54.2,
    stack: ['c#', 'azure'],
  },
  {
    rank: 3,
    id: 'nubeo::becario desarrollo software::remoto',
    title: 'Becario Desarrollo Software',
    company: 'Nubeo',
    location: 'Remoto',
    cvVariant: 'general',
    externalId: '882301',
    sourceId: 'adzuna',
    score: 47.9,
    stack: ['git'],
  },
];

/**
 * A real source URL: an absolute https URL on the board's own host, whose
 * identifying segment is the id the SOURCE gave us. Nothing here is derived
 * from the job title.
 */
function honestUrl(seed: Omit<EntrySeed, 'url'>): string {
  switch (seed.sourceId) {
    case 'greenhouse':
      return `https://boards.greenhouse.io/acmedigital/jobs/${seed.externalId}`;
    case 'lever':
      return `https://jobs.lever.co/kubolabs/${seed.externalId}`;
    default:
      return `https://www.adzuna.es/land/ad/${seed.externalId}`;
  }
}

/**
 * The shipped defect, reproduced exactly.
 *
 * `https://<board>/details/<encoded job title>`. Note what it is NOT: it is not
 * empty, not relative, not a placeholder, and not an invalid URL. It is a
 * perfectly well-formed absolute https URL on a real external host - which is
 * precisely why every schema check, every type and all 626 unit tests waved it
 * through, and why the human found HTTP 403 on all thirteen buttons.
 *
 * The only thing wrong with it is that it was INVENTED from the title instead
 * of taken from the source payload. That is a provenance defect, and provenance
 * is not a property any `z.string().url()` can see.
 */
function fabricatedUrl(seed: Omit<EntrySeed, 'url'>): string {
  return `https://www.adzuna.es/details/${encodeURIComponent(seed.title)}`;
}

function build(
  jobs: readonly QueueEntryFile[],
  sourceReports: readonly SourceReportFile[] = [
    { sourceId: 'greenhouse', query: 'junior developer', status: 'ok', fetched: 3 },
  ],
): QueueFile {
  return {
    generatedAt: GENERATED_AT,
    candidate: 'Adrián',
    totalFetched: 12,
    totalUnique: 9,
    totalRelevant: jobs.length,
    totalJuniorEligible: jobs.length,
    duplicatesRemoved: 3,
    sourceReports,
    excluded: [],
    jobs,
  };
}

/** Three postings whose apply links point at their real source URLs. */
export const HEALTHY_QUEUE: QueueFile = build(
  SEEDS.map((seed) => entry({ ...seed, url: honestUrl(seed) })),
);

/** The same three postings with the shipped fabricated URLs. */
export const FABRICATED_URL_QUEUE: QueueFile = build(
  SEEDS.map((seed) => entry({ ...seed, url: fabricatedUrl(seed) })),
);

/**
 * A PERSISTED run - a real one - with sample postings leaked into it.
 *
 * This is the state `npm start -- --source=all` used to write, and the state
 * any queue file kept from that build is still in: `origin` reads
 * `persisted-run`, the page treats it as trustworthy, and two of the rows are
 * invented postings on `example-board.test` with dead apply buttons.
 *
 * Reachable through `--source` no longer, reachable through an old file
 * forever - which is why the UI answers this question from the data.
 */
export const LEAKED_SAMPLE_QUEUE: QueueFile = build(
  [
    entry({
      rank: 1,
      id: 'kubo labs::trainee software developer::madrid',
      title: 'Trainee Software Developer',
      company: 'Kubo Labs',
      location: 'Madrid',
      cvVariant: 'general',
      externalId: 'fx-010',
      sourceId: 'fixture',
      score: 85.8,
      stack: ['git'],
      url: 'https://example-board.test/offers/fx-010',
    }),
    ...SEEDS.slice(0, 2).map((seed) => entry({ ...seed, rank: seed.rank + 1, url: honestUrl(seed) })),
  ],
  [
    { sourceId: 'fixture', query: 'junior developer', status: 'ok', fetched: 1 },
    { sourceId: 'greenhouse', query: 'junior developer', status: 'ok', fetched: 2 },
  ],
);

/** The title of the invented posting in `LEAKED_SAMPLE_QUEUE`. */
export const LEAKED_SAMPLE_TITLE = 'Trainee Software Developer';

/** A run whose sources all worked and legitimately found nothing. */
export const EMPTY_QUEUE: QueueFile = build([], [
  { sourceId: 'greenhouse', query: 'junior developer', status: 'ok', fetched: 0 },
]);

/**
 * A run whose source queries failed.
 *
 * Empty for a completely different reason than `EMPTY_QUEUE`, and the UI must
 * say so - "the market has nothing for you" and "we could not ask" are not the
 * same message to someone job hunting.
 */
export const DEGRADED_QUEUE: QueueFile = build([], [
  {
    sourceId: 'adzuna',
    query: 'junior developer',
    status: 'failed',
    fetched: 0,
    error: 'HTTP 429 Too Many Requests',
  },
]);

/** Titles in fixture order, for tests that assert on what is on screen. */
export const HEALTHY_TITLES: readonly string[] = SEEDS.map((seed) => seed.title);

/**
 * A KEPT-BUT-UNVERIFIED posting, sitting beside two that were confirmed alive.
 *
 * Modelled on the real case that shaped the whole removal rule: two live junior
 * roles at CaixaBank Tech whose destination answers Node's fetch with
 * `read ECONNRESET` because of bot protection, while serving a browser
 * perfectly. They are real, they are open, and the checker cannot see them.
 *
 * They must therefore be KEPT and MARKED - not removed, and not silently
 * presented as if the check had succeeded. That is what this fixture drives.
 */
export const MIXED_LIVENESS_QUEUE: QueueFile = build(
  SEEDS.map((seed, index) => ({
    ...entry({ ...seed, url: honestUrl(seed) }),
    liveness:
      index === 0
        ? {
            verdict: 'unverified' as const,
            status: null,
            checkedAt: GENERATED_AT,
            error: 'read ECONNRESET',
          }
        : { verdict: 'alive' as const, status: 200, checkedAt: GENERATED_AT, error: null },
  })),
);

/** The title of the posting the checker could not vouch for. */
export const UNVERIFIED_TITLE = SEEDS[0]?.title ?? '';
