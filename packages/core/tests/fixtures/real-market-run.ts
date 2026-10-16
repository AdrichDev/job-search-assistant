import { createJob, type Job } from '../../src/domain/job.js';

/**
 * The 25 postings a real `npm start -- --source=aggregator` run surfaced on
 * 2026-09-08.
 *
 * ====================================================================
 * WHAT THIS FIXTURE IS NOT: it is NOT queue-seed material.
 * ====================================================================
 *
 * THE URLs ARE GONE. They were never captured here, and they cannot be
 * recovered from anything in this repository - the live run's real links, of
 * the form
 *
 *   https://www.aggregator.es/details/5874810786?utm_medium=api&utm_source=...
 *
 * exist nowhere on disk. This file previously papered over that by building a
 * URL out of the job TITLE:
 *
 *   url: `https://www.aggregator.es/details/${encodeURIComponent(posting.title)}`
 *
 * Every one of those answered HTTP 403, and `scripts/seed-queue.ts` wrote all
 * 13 of them into `output/queue.json`, where they became apply buttons a human
 * clicked and nothing happened. That is the defect this comment exists to make
 * impossible to repeat.
 *
 * So: this fixture cannot seed a user-facing queue, and `seed:queue` refuses to
 * try. A queue whose links are invented is worse than no queue at all - an
 * empty screen is an honest "I have nothing for you today", while a clickable
 * lie costs the user time and costs the tool its credibility.
 *
 * ====================================================================
 * WHAT IT IS: a regression corpus for the software-relevance gate.
 * ====================================================================
 *
 * The gate does not read URLs, so the loss costs it nothing. What it reads is
 * real:
 *
 * - `title`, `company` and `postedAt` are copied byte-for-byte from that run.
 * - generic aggregator only returns a truncated snippet of the description, and the queue
 *   file does not persist it. So the body here is NOT the original ad text. It
 *   is the exact set of technical keywords that run recorded in
 *   `requirements.matchedStack` for each posting - nothing added, nothing
 *   guessed. A posting whose `matchedStack` was empty gets an empty body.
 *
 * That reconstruction is deliberately hostile to the gate: it strips every
 * incidental word an ad normally carries and keeps only the technical tokens
 * that were provably there. If the gate can separate software from dentistry on
 * this, it is not leaning on prose it will not have in production.
 *
 * `location` is likewise not recorded per posting; the run was a Madrid search,
 * and the probe below states Madrid as an ASSUMPTION rather than a fact. That
 * is acceptable for a gate probe and unacceptable for anything a user reads,
 * which is the same line the URL rule draws.
 */

interface RealPosting {
  readonly title: string;
  readonly company: string;
  readonly postedAt: string;
  /** Score this posting reached in the real run, BEFORE the relevance gate existed. */
  readonly scoreBefore: number;
  /** Keywords the real run recorded in `requirements.matchedStack`. */
  readonly matchedStack: readonly string[];
  /** Whether a human reading the title would call this a software job. */
  readonly software: boolean;
}

export const REAL_RUN_NOW = new Date('2026-09-08T08:27:53.081Z');

export const REAL_AGGREGATOR_RUN: readonly RealPosting[] = [
  {
    title: 'Optima Solutions Junior Power Platform Developer',
    company: 'PPG',
    postedAt: '2026-09-08T00:29:32.000Z',
    scoreBefore: 78.2,
    matchedStack: ['power apps', 'power platform', 'power automate'],
    software: true,
  },
  {
    title: 'Programador/A Junior, Num: 132026007029',
    company: 'Jobbydoo',
    postedAt: '2026-09-06T00:27:17.000Z',
    scoreBefore: 75.5,
    matchedStack: ['erp', 'sql', 'jira'],
    software: true,
  },
  {
    title:
      'Consultor/A Técnico/A - Funcional Microsoft Dynamics 365 Business Central - Remoto- Visitas Pun[]',
    company: 'KA Resources Recruitment SL',
    postedAt: '2026-09-08T00:29:43.000Z',
    scoreBefore: 73.6,
    matchedStack: ['dynamics 365', 'dynamics', 'business central'],
    software: true,
  },
  {
    title: 'Consultor/A Dynamics 365 Bc – Análisis Y Desarrollo Remoto',
    company: 'KA Resources Recruitment SL',
    postedAt: '2026-09-08T00:28:09.000Z',
    scoreBefore: 73.6,
    matchedStack: ['dynamics 365', 'dynamics', 'business central'],
    software: true,
  },
  {
    title: 'Power Platform Engineer - Remote & Flexible Hours',
    company: 'KA Resources Recruitment SL',
    postedAt: '2026-09-08T00:29:14.000Z',
    scoreBefore: 68,
    matchedStack: ['power apps', 'power platform'],
    software: true,
  },
  {
    title: 'Satellite Control Full-Stack Engineer (ReactNode) – Hybrid',
    company: 'GMV',
    postedAt: '2026-09-08T00:29:37.000Z',
    scoreBefore: 54.8,
    matchedStack: ['full stack'],
    software: true,
  },
  {
    title: 'Power Platform Developer',
    company: 'KA Resources Recruitment SL',
    postedAt: '2026-09-08T00:28:45.000Z',
    scoreBefore: 68,
    matchedStack: ['power apps', 'power platform'],
    software: true,
  },
  {
    title: 'Frontend Software Engineer – React',
    company: 'Babel',
    postedAt: '2026-09-08T00:28:13.000Z',
    scoreBefore: 68,
    matchedStack: ['react', 'frontend'],
    software: true,
  },
  {
    title: 'Analista Junior Estrategia Call Center',
    company: 'Jobbydoo',
    postedAt: '2026-09-08T00:28:45.000Z',
    scoreBefore: 67,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Ingeniero/A Comercial Junior (H/M) Otis Madrid',
    company: 'Otis Elevator Co.',
    postedAt: '2026-09-06T00:26:32.000Z',
    scoreBefore: 66.3,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Senior Full Stack Engineer (AI & GenAI) | Python, React, AWS',
    company: 'knowmad mood',
    postedAt: '2026-08-17T09:39:17.000Z',
    scoreBefore: 43.5,
    matchedStack: ['react', 'python', 'full stack'],
    software: true,
  },
  {
    title: 'PMO Junior – Calidad de Proyecto, Compras y Proveedores',
    company: 'Expleo',
    postedAt: '2026-09-04T03:30:26.000Z',
    scoreBefore: 65.7,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Junior Art Director (Graduate Program Barcelona)',
    company: 'Ogilvy',
    postedAt: '2026-09-08T00:28:33.000Z',
    scoreBefore: 61.4,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Junior HR para multinacional x sustitución - zona Valdeolmos Alalpardo',
    company: 'Temps',
    postedAt: '2026-08-21T12:37:16.000Z',
    scoreBefore: 61.2,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Qa Tester',
    company: 'BIP UK | BIP US',
    postedAt: '2026-09-08T00:28:15.000Z',
    scoreBefore: 60.4,
    matchedStack: ['automatizacion'],
    software: true,
  },
  {
    title: 'Ingeniero/a de Procesos Senior (H/M/X) 2118',
    company: 'Vèringer Engineering',
    postedAt: '2026-08-26T23:55:16.000Z',
    scoreBefore: 37.5,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Desarrollador Full Stack',
    company: 'Thomas Brown Digital Solutions S.L.',
    postedAt: '2026-09-05T09:46:18.000Z',
    scoreBefore: 59.5,
    matchedStack: ['full stack'],
    software: true,
  },
  {
    title: 'Junior Sales Executive – Fintech Solutions',
    company: 'Finsolutia',
    postedAt: '2026-09-08T00:28:04.000Z',
    scoreBefore: 57.3,
    matchedStack: [],
    software: false,
  },
  {
    title: 'FullStack Java React Engineer 100% (f/m/d)',
    company: 'Julius Baer',
    postedAt: '2026-08-28T10:02:52.000Z',
    scoreBefore: 56.9,
    matchedStack: ['react', 'java', 'fullstack'],
    software: true,
  },
  {
    title: 'Administrativo/A Contabilidad',
    company: 'Mutual Médica',
    postedAt: '2026-09-08T00:28:55.000Z',
    scoreBefore: 56.8,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Senior Software Engineer',
    company: 'Nexthink',
    postedAt: '2026-08-21T16:09:03.000Z',
    scoreBefore: 30.1,
    matchedStack: [],
    software: true,
  },
  {
    title: 'Se Necesitan Odontólogos',
    company: 'Dentego',
    postedAt: '2026-09-08T00:28:25.000Z',
    scoreBefore: 56.8,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Treasury Administrator',
    company: 'GMV',
    postedAt: '2026-09-08T00:28:03.000Z',
    scoreBefore: 56.8,
    matchedStack: ['erp'],
    software: false,
  },
  {
    title: 'Consultor It De Proyectos Europeos: Itil/Itsm Internacional',
    company: 'BIP UK | BIP US',
    postedAt: '2026-09-06T00:27:24.000Z',
    scoreBefore: 56.1,
    matchedStack: [],
    software: false,
  },
  {
    title: 'Odontólogo(A)',
    company: 'Dentego',
    postedAt: '2026-09-06T00:27:01.000Z',
    scoreBefore: 56.1,
    matchedStack: [],
    software: false,
  },
];

/**
 * `.invalid` is reserved by RFC 2606 and is guaranteed never to resolve.
 *
 * A probe URL has to exist because the domain now refuses to mint a `Job`
 * without one - correctly. It is therefore chosen to be UNMISTAKABLE: it names
 * itself a probe, it cannot be confused with an generic aggregator link, and if one ever
 * escapes into a user-facing artifact it fails instantly and visibly rather
 * than returning a plausible-looking 403 that somebody argues about for a day.
 *
 * The index, not the title, is the discriminator. Deriving anything URL-shaped
 * from a title is the exact habit this whole change exists to break.
 */
const SCORING_PROBE_URL = (index: number) => `https://scoring-probe.invalid/aggregator/${index}`;

/**
 * Turns a recorded posting into a `Job` FOR SCORING ASSERTIONS ONLY.
 *
 * Read the file header before using this anywhere else. The URL is a stub and
 * the location is an assumption; neither is real data, and neither may reach a
 * queue a human reads. There is deliberately no `realPostingJobs()` helper any
 * more - a one-line way to turn this fixture into a shippable queue is exactly
 * what produced the defect.
 */
export function scoringProbeJob(posting: RealPosting): Job {
  const index = REAL_AGGREGATOR_RUN.indexOf(posting);

  return createJob({
    sourceId: 'aggregator',
    externalId: `probe-${index}`,
    title: posting.title,
    company: posting.company,
    location: 'Madrid',
    description: posting.matchedStack.join(' '),
    url: SCORING_PROBE_URL(index),
    postedAt: new Date(posting.postedAt),
  });
}

/** Every recorded posting as a scoring probe. Never a queue. */
export function scoringProbeJobs(): readonly Job[] {
  return REAL_AGGREGATOR_RUN.map(scoringProbeJob);
}

export function realPostingByTitle(fragment: string): RealPosting {
  const found = REAL_AGGREGATOR_RUN.find((posting) => posting.title.includes(fragment));
  if (found === undefined) {
    throw new Error(`No real posting matches "${fragment}"`);
  }
  return found;
}
