/**
 * WHERE AN APPLY LINK CAME FROM - the rule, in production code, where the
 * pipeline can be held to it.
 *
 * ## Why this module moved here
 *
 * These rules were written in `e2e/support/link-integrity.ts` after thirteen
 * "Aplicar" buttons shipped pointing at
 *
 *     https://www.aggregator.es/details/<encodeURIComponent(job title)>
 *
 * All thirteen returned HTTP 403. The rules were right. Their ADDRESS was
 * wrong: living in the browser suite, they could only ever be applied to queues
 * that suite seeded itself, so they were structurally incapable of noticing
 * what the pipeline produced. Months later `npm start -- --source=all` put two
 * `example-board.test` postings at positions #1 and #3 of the user's real
 * queue, and the link suite was green throughout.
 *
 * A rule that cannot be run against production output is not a guarantee, it is
 * a comment with a test runner attached. So the rules live in the domain now,
 * and three callers share them:
 *
 *   - the CLI, auditing its own queue on every real run;
 *   - `tests/app/pipeline-link-provenance.test.ts`, over a queue the pipeline
 *     actually built;
 *   - the E2E suite, over the rendered `href` attributes.
 *
 * ## What is being checked
 *
 * PROVENANCE, not reachability. Not one function here makes a request: fetching
 * these addresses would be the third-party board traffic this project refuses
 * to generate, and it would make every check depend on a stranger's server
 * staying at HTTP 200. The defect was never "the URL is down". It was "the URL
 * was invented from a field we happened to have", and that is visible in the
 * string.
 *
 * Pure: no I/O, no node builtins, no third-party imports. Enforced by
 * `tests/architecture/purity.test.ts`.
 */

/** Hosts that mean "this link goes nowhere useful". */
const PLACEHOLDER_HOSTS: ReadonlySet<string> = new Set([
  'example.com',
  'www.example.com',
  'example.org',
  'example.net',
  /*
   * The committed sample catalogue's own domain. `.test` is reserved by
   * RFC 2606 and resolves nowhere on purpose, which is the right choice for
   * demo data and the reason a demo posting must never reach a real queue.
   */
  'example-board.test',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
]);

/** Whole-href values seen in the wild standing in for "we had nothing". */
const PLACEHOLDER_HREFS: ReadonlySet<string> = new Set([
  '',
  '#',
  'about:blank',
  'null',
  'undefined',
  'javascript:void(0)',
  'todo',
  'tbd',
  'n/a',
]);

export type LinkProblemRule =
  | 'placeholder'
  | 'not-absolute'
  | 'bad-protocol'
  | 'placeholder-host'
  | 'self-referential'
  | 'title-derived';

/** One address, and the posting title it is supposed to belong to. */
export interface PostingLink {
  /** `null` is accepted so a missing DOM attribute reports as a problem, not a crash. */
  readonly url: string | null;
  readonly title: string;
}

export interface LinkProblem {
  readonly title: string;
  readonly href: string;
  readonly rule: LinkProblemRule;
  readonly detail: string;
}

export interface LinkInspectionOptions {
  /**
   * The origin of the app showing the link, when there is one.
   *
   * Only the browser suite can know this. Omitted everywhere else, and the
   * self-referential rule simply does not fire - which is correct: a CLI queue
   * has no origin to point back at.
   */
  readonly appOrigin?: string;
}

/** Lowercase, alphanumerics only, single dashes. Kills encoding differences. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Does the URL carry an identifier the app could not have invented?
 *
 * A genuine posting URL is addressed by something opaque - a numeric board id,
 * a UUID, a long token. The fabricated URLs had nothing of the sort: strip the
 * title out and only the literal path segment `details` remained.
 *
 * This is what stops the title check firing on legitimate URLs that happen to
 * include a title slug for SEO, e.g.
 * `boards.greenhouse.io/acme/jobs/4471203-junior-frontend-developer`. That URL
 * contains the title AND a real id, so it is addressable and fine.
 */
function hasOpaqueIdentifier(url: URL): boolean {
  const candidates = [...url.pathname.split('/'), ...[...url.searchParams.values()]].filter(
    (part) => part.length > 0,
  );

  return candidates.some(
    (part) =>
      /\d{4,}/.test(part) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) ||
      /^[0-9a-zA-Z_-]{16,}$/.test(part),
  );
}

/**
 * The regression rule.
 *
 * Fires when the job title appears in the URL and the URL has no identifier of
 * its own - i.e. the address IS the title, which is only ever true when
 * somebody synthesised it.
 */
export function isTitleDerived(url: URL, title: string): boolean {
  const titleSlug = slug(title);
  if (titleSlug.length < 8) {
    // Too short to distinguish from an ordinary path word; refusing to guess is
    // better than a false accusation.
    return false;
  }

  let address: string;
  try {
    address = decodeURIComponent(`${url.pathname}${url.search}`);
  } catch {
    // A malformed percent-escape is not evidence of fabrication.
    address = `${url.pathname}${url.search}`;
  }

  return slug(address).includes(titleSlug) && !hasOpaqueIdentifier(url);
}

/**
 * Every rule, applied to one link. Returns the problems rather than throwing so
 * a failure can report ALL the dead buttons at once instead of only the first -
 * "one link is broken" and "every link is broken" need different reactions.
 */
export function inspectPostingLink(
  link: PostingLink,
  options: LinkInspectionOptions = {},
): readonly LinkProblem[] {
  const problems: LinkProblem[] = [];
  const raw = link.url ?? '';
  const report = (rule: LinkProblemRule, detail: string): void => {
    problems.push({ title: link.title, href: raw, rule, detail });
  };

  if (PLACEHOLDER_HREFS.has(raw.trim().toLowerCase())) {
    report('placeholder', 'the href is a placeholder value, not an address');
    return problems;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Relative hrefs land here: they resolve against our own origin, so an
    // apply button carrying one silently points back at this app.
    report('not-absolute', 'the href is not an absolute URL, so it points back at this app');
    return problems;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    report('bad-protocol', `"${url.protocol}" is not a scheme a browser can open a posting with`);
  }

  if (PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase())) {
    report('placeholder-host', `"${url.hostname}" does not host real postings`);
  }

  if (options.appOrigin !== undefined && url.origin === options.appOrigin) {
    report('self-referential', 'the apply link points back at this application');
  }

  if (isTitleDerived(url, link.title)) {
    report(
      'title-derived',
      `the address is built from the job title ("${link.title}") and carries no ` +
        'identifier from the source, so it was synthesised rather than reported',
    );
  }

  return problems;
}

/** The same rules over a list. Collects, never short-circuits. */
export function auditPostingLinks(
  links: readonly PostingLink[],
  options: LinkInspectionOptions = {},
): readonly LinkProblem[] {
  return links.flatMap((link) => inspectPostingLink(link, options));
}

/** The shape of a queue this audit needs: titles and the address beside them. */
export interface AuditableQueue {
  readonly jobs: readonly { readonly title: string; readonly url: string }[];
}

/**
 * The whole point of moving this module: auditing what the pipeline PRODUCED.
 *
 * Structurally typed rather than importing `JobQueue`, so the domain does not
 * have to reach up into `ports` - a `JobQueue` satisfies it as it is.
 */
export function auditQueueLinks(
  queue: AuditableQueue,
  options: LinkInspectionOptions = {},
): readonly LinkProblem[] {
  return auditPostingLinks(queue.jobs, options);
}

/** One readable block per broken link, for a CLI report or an assertion message. */
export function describeLinkProblems(problems: readonly LinkProblem[]): string {
  return problems
    .map((p) => `  [${p.rule}] "${p.title}"\n      href:   ${p.href}\n      reason: ${p.detail}`)
    .join('\n');
}
