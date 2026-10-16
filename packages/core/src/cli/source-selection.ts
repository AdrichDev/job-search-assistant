/**
 * `--source` parsing.
 *
 * It used to be a three-way enum. With five providers it is a SET, because the
 * combinations the candidate actually needs are real:
 *
 *   --source=fixture              offline demo data, no network, no keys
 *   --source=boards               the configured company ATS boards
 *   --source=greenhouse,ashby     one bad provider excluded for a run
 *   --source=all                  every REAL source
 *
 * ## The line this module now draws, and why
 *
 * `all` used to mean "every selectable source", fixture included. The user ran
 * the documented `npm start -- --source=all` and got:
 *
 *   Contributed: fixture 105, greenhouse 64, lever 14, ashby 29, ...
 *
 *   #1  Trainee Software Developer  Kubo Labs  Madrid  85.8
 *       link: https://example-board.test/offers/fx-010
 *   #3  Becario de Desarrollo Web   Innovatek  Madrid  77.0
 *       link: https://example-board.test/offers/fx-002
 *
 * 105 invented postings competing for position against real vacancies, on a
 * reserved TLD that resolves nowhere - dead apply buttons, which is the exact
 * class of defect this project already shipped once.
 *
 * Two rules follow, and they are separate rules:
 *
 *   1. `all` expands to the REAL sources. The sample catalogue is not a source
 *      of job-market information; it is a demo, and a demo has to be asked for
 *      by name.
 *
 *   2. Sample data and real sources MAY NOT SHARE A RUN. This is the part worth
 *      arguing about, so the argument is written down:
 *
 *      A mixed queue is not one list with a warning on it. It is a list in
 *      which every single row has to be re-checked for provenance by the human
 *      before they act on it, because the ranked table interleaves them by
 *      recency and the two look identical. The only honest interface for that
 *      is a per-row marker, and a per-row marker on a list nobody asked to be
 *      mixed is a worse outcome than simply not mixing.
 *
 *      The mixing has no use case either. The fixture exists for an offline
 *      demo and for tests. A demo does not become more useful by having real
 *      vacancies stirred into it, and a real run does not become more useful by
 *      having invented ones. Every plausible request - "let me see the UI with
 *      data" - is served by `--source=fixture` alone.
 *
 *      So it is refused at parse time, loudly, before a single request is made,
 *      and the error names the flag that does what the user probably wanted.
 *      A refusal is cheaper than a banner, because a banner above a list of
 *      offers is the first thing a person stops reading on day three.
 *
 * Note what this does NOT do: it does not make `--source=fixture` illegal, and
 * it does not make fixture data safe. When the catalogue IS selected, its
 * postings are marked as sample data everywhere they surface - see
 * `domain/sample-data.ts`, the CLI banner in `cli/render-table.ts` and the
 * amber notice in the web app.
 *
 * Pure, and therefore unit-tested rather than discovered through the CLI's
 * side effects.
 */

export type SelectableSourceId =
  | 'fixture'
  | 'manfred'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'landingjobs'
  | 'arbeitnow';

/**
 * The company-board providers: per-company APIs, no key, no search endpoint.
 *
 * SmartRecruiters belongs here and not beside Manfred, because the shortcut
 * describes a KIND of source rather than a list of names. Someone typing
 * `--source=boards` means "sweep the employers I have configured", and a fourth
 * ATS answering that description would be surprising to leave out.
 */
export const BOARD_SOURCE_IDS: readonly SelectableSourceId[] = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
];

/**
 * Sources whose postings are INVENTED.
 *
 * The single entry here is why this constant exists as a list rather than as a
 * comparison against the string `'fixture'` scattered around the CLI: "which
 * sources are not real" is a product question with one answer, and it is
 * answered here and mirrored in `domain/sample-data.ts` for the data side.
 */
export const SAMPLE_SOURCE_IDS: readonly SelectableSourceId[] = ['fixture'];

/**
 * Sources that report live vacancies. `all` means EXACTLY these.
 *
 * Order is the order the run summary prints, and it ends with the greenhouse
 * for one practical reason: it is the only source whose input a human has to
 * have produced. A run that finds an empty `data/greenhouses/` should read as
 * "you have not saved any alerts yet", which is easier to see at the bottom of
 * the report than in the middle of it.
 */
export const REAL_SOURCE_IDS: readonly SelectableSourceId[] = [
  // First because it is the best match for this candidate: the Spanish tech
  // market, in Spanish, and the only source that publishes a salary.
  'manfred',
  ...BOARD_SOURCE_IDS,
  // These two are European rather than Spanish and are near the bottom for
  // that reason. See their adapters for the measured Spanish yield - it is
  // small, and saying so where the order is decided is more useful than a
  // comment nobody reads twice.
  'landingjobs',
  'arbeitnow',
];

/**
 * Everything a user may name. Sample sources first, so `--help` introduces the
 * offline option before the ones that need a network or a key.
 */
export const SELECTABLE_SOURCE_IDS: readonly SelectableSourceId[] = [
  ...SAMPLE_SOURCE_IDS,
  ...REAL_SOURCE_IDS,
];

/** Names that stand for several sources at once. */
const ALIASES: Readonly<Record<string, readonly SelectableSourceId[]>> = {
  all: REAL_SOURCE_IDS,
  boards: BOARD_SOURCE_IDS,
};

function isSelectable(value: string): value is SelectableSourceId {
  return (SELECTABLE_SOURCE_IDS as readonly string[]).includes(value);
}

export function isSampleSourceId(value: SelectableSourceId): boolean {
  return SAMPLE_SOURCE_IDS.includes(value);
}

/**
 * Parses the raw flag into an ordered, duplicate-free list.
 *
 * Order is first-mentioned so the output is predictable, and duplicates are
 * collapsed so `--source=boards,greenhouse` fetches Greenhouse once rather than
 * hitting a free endpoint twice for no reason.
 */
export function parseSourceSelection(raw: string | undefined): readonly SelectableSourceId[] {
  // Absent means the offline fixture: a bare `npm start` must never reach out
  // to the network by accident.
  if (raw === undefined) {
    return ['fixture'];
  }

  const tokens = raw
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error(
      `--source needs at least one source. Valid values: ${[...SELECTABLE_SOURCE_IDS, 'boards', 'all'].join('|')}`,
    );
  }

  const selected: SelectableSourceId[] = [];

  for (const token of tokens) {
    const expanded = ALIASES[token] ?? (isSelectable(token) ? [token] : undefined);

    if (expanded === undefined) {
      throw new Error(
        `--source received an unknown source "${token}". Valid values: ${[...SELECTABLE_SOURCE_IDS, 'boards', 'all'].join('|')}`,
      );
    }

    for (const id of expanded) {
      if (!selected.includes(id)) {
        selected.push(id);
      }
    }
  }

  assertNotMixed(selected);

  return selected;
}

/**
 * Refuses a run that would interleave invented postings with real vacancies.
 *
 * Thrown from the parser rather than warned about downstream, so it costs the
 * user nothing: no request is issued, no queue is written, and the previous
 * `output/queue.json` is untouched. The message names the sample source that
 * did it and the exact flag that produces a pure demo run, because an error
 * that only says "no" makes people guess.
 */
function assertNotMixed(selected: readonly SelectableSourceId[]): void {
  const sample = selected.filter(isSampleSourceId);
  const real = selected.filter((id) => !isSampleSourceId(id));

  if (sample.length === 0 || real.length === 0) {
    return;
  }

  throw new Error(
    `--source may not mix sample data with real sources. ` +
      `"${sample.join(', ')}" is the committed demo catalogue: its postings are invented and ` +
      'its links point at example-board.test, which does not resolve. Interleaved with ' +
      `"${real.join(', ')}" they would compete for position in a list you act on, with dead ` +
      'apply buttons. Run the demo on its own with --source=fixture, or drop it and run ' +
      `--source=${real.join(',')}.`,
  );
}
