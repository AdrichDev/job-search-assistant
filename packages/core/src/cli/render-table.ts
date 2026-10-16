import { auditQueueLinks, describeLinkProblems } from '../domain/link-provenance.js';
import { countSampleDataEntries, hasSampleDataSource } from '../domain/sample-data.js';
import type { ExcludedEntry, JobQueue, QueueEntry } from '../ports/queue-writer.js';

/** Pure presentation. No I/O here, so the renderer stays unit-testable. */

/**
 * What a sample posting is prefixed with, everywhere it is printed.
 *
 * On the ROW rather than only in a banner, and that is deliberate: the ranked
 * table is routinely longer than a terminal screen, so a banner above it is
 * gone by the time the reader is choosing which offer to open. The marker has
 * to travel with the offer.
 */
const SAMPLE_MARKER = '[SAMPLE]';

function markSample(entry: QueueEntry, text: string): string {
  return hasSampleDataSource(entry) ? `${SAMPLE_MARKER} ${text}` : text;
}

interface Column {
  readonly header: string;
  readonly width: number;
  readonly align: 'left' | 'right';
  readonly value: (entry: QueueEntry) => string;
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function pad(text: string, width: number, align: 'left' | 'right'): string {
  const clipped = truncate(text, width);
  return align === 'right' ? clipped.padStart(width) : clipped.padEnd(width);
}

function ageLabel(postedAt: string, now: Date): string {
  const days = Math.round((now.getTime() - new Date(postedAt).getTime()) / 86_400_000);
  if (days <= 0) {
    return 'today';
  }
  return `${days}d`;
}

/** `-` reads as "nothing here yet" faster than an empty cell. */
function statusLabel(entry: QueueEntry): string {
  return entry.applicationStatus === 'not_applied' ? '-' : entry.applicationStatus;
}

const COLUMNS = (now: Date): Column[] => [
  { header: '#', width: 3, align: 'right', value: (entry) => String(entry.rank) },
  // AGE leads, because AGE is what the order means. The old layout put SCORE in
  // the second column of a score-ordered table; keeping it there over a
  // recency-ordered one would imply an ordering that no longer exists.
  { header: 'AGE', width: 5, align: 'right', value: (entry) => ageLabel(entry.postedAt, now) },
  {
    header: 'TITLE',
    width: 44,
    align: 'left',
    value: (entry) => markSample(entry, entry.title),
  },
  { header: 'COMPANY', width: 22, align: 'left', value: (entry) => entry.company },
  { header: 'LOCATION', width: 22, align: 'left', value: (entry) => entry.location },
  { header: 'STATUS', width: 9, align: 'left', value: statusLabel },
  { header: 'CV', width: 9, align: 'left', value: (entry) => entry.cvVariant },
  // Last column, deliberately. Still printed because it is still computed and
  // still worth inspecting; parked at the far right because it decides nothing.
  { header: 'SCORE', width: 5, align: 'right', value: (entry) => entry.score.toFixed(1) },
];

/** The queue table: the primary artifact the candidate reads every morning. */
export function renderRankedTable(queue: JobQueue): string {
  const now = new Date(queue.generatedAt);
  const columns = COLUMNS(now);

  const header = columns.map((column) => pad(column.header, column.width, column.align)).join('  ');
  const divider = columns.map((column) => '-'.repeat(column.width)).join('  ');

  if (queue.jobs.length === 0) {
    return [header, divider, '(no jobs found)'].join('\n');
  }

  const rows = queue.jobs.map((entry) =>
    columns.map((column) => pad(column.value(entry), column.width, column.align)).join('  '),
  );

  return [header, divider, ...rows].join('\n');
}

/**
 * What removed a posting, in the width of a column.
 *
 * `dead-link` is worth reading as a different KIND of thing from the other two,
 * and the wording is chosen to make that obvious: `not-tech` and `not-junior`
 * are judgements about the posting's content, while `dead-link` means the
 * posting qualified on every count and the address simply stopped answering.
 * Nothing about the candidate or the vacancy failed.
 *
 * A total record rather than a ternary, so adding a fourth exclusion cannot
 * silently fall through to the label of an unrelated one.
 */
const EXCLUSION_LABELS: Readonly<Record<ExcludedEntry['excludedBy'], string>> = {
  software_relevance: 'not-tech',
  junior_eligibility: 'not-junior',
  location_incompatible: 'location',
  experience_over_limit: 'experience',
  seniority_excluded: 'seniority',
  dead_link: 'dead-link',
};

const EXCLUDED_COLUMNS: readonly { header: string; width: number; align: 'left' | 'right'; value: (entry: ExcludedEntry) => string }[] = [
  {
    header: 'FILTER',
    width: 10,
    align: 'left',
    value: (entry) => EXCLUSION_LABELS[entry.excludedBy],
  },
  {
    header: 'WOULD',
    width: 5,
    align: 'right',
    value: (entry) => entry.scoreBeforeGate.toFixed(1),
  },
  { header: 'REL', width: 4, align: 'right', value: (entry) => entry.softwareRelevance.toFixed(2) },
  { header: 'TITLE', width: 38, align: 'left', value: (entry) => entry.title },
  { header: 'COMPANY', width: 20, align: 'left', value: (entry) => entry.company },
  { header: 'WHY IT WAS EXCLUDED', width: 72, align: 'left', value: (entry) => entry.reason },
];

/**
 * The postings the two filters removed.
 *
 * This section is not optional garnish. The candidate asked for tech jobs open
 * to juniors, which means the pipeline is now throwing work away on his behalf -
 * and a filter he cannot read is a filter he cannot correct. `FILTER` says which
 * of the two fired; `WOULD` is the score the posting would have had, so a
 * mistake is immediately visible as a high number sitting in this table.
 */
export function renderExcludedTable(queue: JobQueue): string {
  if (queue.excluded.length === 0) {
    return '';
  }

  const header = EXCLUDED_COLUMNS.map((column) =>
    pad(column.header, column.width, column.align),
  ).join('  ');
  const divider = EXCLUDED_COLUMNS.map((column) => '-'.repeat(column.width)).join('  ');
  const rows = queue.excluded.map((entry) =>
    EXCLUDED_COLUMNS.map((column) => pad(column.value(entry), column.width, column.align)).join('  '),
  );

  return [
    `Excluded by the two filters (${queue.excluded.length}):`,
    '',
    header,
    divider,
    ...rows,
  ].join('\n');
}

/**
 * Why the best entries scored what they scored.
 *
 * The ranking is only useful if it can be argued with, so the top entries ship
 * their full per-dimension justification.
 */
export function renderScoreExplanations(queue: JobQueue, count: number): string {
  const entries = queue.jobs.slice(0, count);
  if (entries.length === 0) {
    return '';
  }

  const blocks = entries.map((entry) => {
    const lines = entry.breakdown.map(
      (item) =>
        `    ${item.dimension.padEnd(13)} ${item.value.toFixed(2)} x ${item.weight.toFixed(2)} = ${item.contribution
          .toFixed(1)
          .padStart(5)} pts  ${item.reason}`,
    );
    return [
      `  #${entry.rank} ${markSample(entry, entry.title)} — ${entry.company} (${entry.score.toFixed(1)}/100, CV: ${entry.cvVariant})`,
      ...lines,
      // The line the user's report showed the dead address on. If this posting
      // is invented, the address gets the marker too - the link is the one
      // thing here somebody is about to click.
      `    link: ${entry.url}${hasSampleDataSource(entry) ? `  ${SAMPLE_MARKER} not a real posting` : ''}`,
    ].join('\n');
  });

  return [`Why the top ${entries.length} rank where they do:`, '', ...blocks].join('\n');
}

/**
 * One line saying what each provider brought back.
 *
 * With a single source this was implicit in `totalFetched`. With five it is the
 * first diagnostic question worth asking, and the silent failure it catches is
 * the nasty one: a provider that quietly contributes zero for weeks looks
 * exactly like a provider that is working in a quiet market.
 *
 * Per-query sources are summed, because "aggregator 25" is the useful fact and
 * seven rows of "aggregator 4" is not.
 */
function renderSourceContributions(queue: JobQueue): string | null {
  if (queue.sourceReports.length === 0) {
    return null;
  }

  const totals = new Map<string, { fetched: number; failed: number }>();
  for (const report of queue.sourceReports) {
    const current = totals.get(report.sourceId) ?? { fetched: 0, failed: 0 };
    totals.set(report.sourceId, {
      fetched: current.fetched + report.fetched,
      failed: current.failed + (report.status === 'failed' ? 1 : 0),
    });
  }

  const parts = [...totals.entries()].map(([sourceId, total]) =>
    total.failed > 0 ? `${sourceId} ${total.fetched} (failed)` : `${sourceId} ${total.fetched}`,
  );

  return `Contributed: ${parts.join(', ')}`;
}

/**
 * Company boards that did not answer.
 *
 * Reported as a note, never as "Degraded run": one 404 out of twenty-eight
 * boards is an ordinary Tuesday, and spending the loud warning on it is how a
 * warning stops being read.
 */
function renderBoardOutages(queue: JobQueue): string | null {
  const outages = queue.sourceReports.flatMap((report) =>
    (report.degradedTargets ?? []).map((entry) => `${report.sourceId}/${entry.target}`),
  );

  if (outages.length === 0) {
    return null;
  }

  return `${outages.length} company board(s) unreachable this run: ${outages.join(', ')}`;
}

/**
 * "SOME OF THESE OFFERS ARE INVENTED."
 *
 * Printed whenever the queue contains a posting from the sample catalogue,
 * however it got there - `--source=fixture`, a stale `output/queue.json`, a
 * hand edit. Not conditional on which flags this particular run was given: the
 * question the reader needs answered is about the DATA in front of them, and
 * tying the answer to a flag is how the web app ended up honest only about its
 * own offline fallback while the CLI said nothing at all.
 *
 * Returns `null` rather than an empty string so a caller cannot print a blank
 * line where a warning was supposed to be.
 */
export function renderSampleDataNotice(queue: JobQueue): string | null {
  const sample = countSampleDataEntries(queue.jobs);
  if (sample === 0) {
    return null;
  }

  const everything = sample === queue.jobs.length;

  return [
    '='.repeat(78),
    `SAMPLE DATA IN THIS QUEUE - ${sample} of ${queue.jobs.length} offers below are NOT REAL.`,
    '',
    `  They come from the committed demo catalogue. Their employers do not exist and`,
    `  their links point at example-board.test, a reserved domain that resolves`,
    `  nowhere, so every apply button on a ${SAMPLE_MARKER} row is dead.`,
    '',
    everything
      ? '  This is a demo run. For real vacancies use --source=all, or --source=boards'
      : '  Re-run to replace them: --source=all, or --source=boards',
    '  if another source is temporarily out of quota.',
    '='.repeat(78),
  ].join('\n');
}

/**
 * THE PIPELINE AUDITING ITS OWN OUTPUT.
 *
 * Same rules as `tests/app/pipeline-link-provenance.test.ts` and the browser
 * suite, from `domain/link-provenance.ts`, applied to the queue this run just
 * built - before it is written and before anybody clicks anything.
 *
 * It exists because the alternative already failed: the E2E link suite was
 * green for months while the documented command produced `example-board.test`
 * apply buttons, because that suite only ever inspected queues it wrote itself.
 * A check the user sees on the run that caused the problem is worth more than a
 * check a maintainer sees later.
 *
 * No request is made. Provenance is read from the address, which is where the
 * defect lives - fetching these URLs would be the third-party board traffic
 * this project refuses to generate.
 */
export function renderLinkAudit(queue: JobQueue): string | null {
  const problems = auditQueueLinks(queue);
  if (problems.length === 0) {
    return null;
  }

  return [
    `LINK AUDIT: ${problems.length} of ${queue.jobs.length} apply link(s) are not usable posting addresses.`,
    '',
    describeLinkProblems(problems),
    '',
    '  These were NOT repaired. A link this pipeline cannot vouch for is reported,',
    '  never replaced with a guess - a fabricated address is how thirteen dead',
    '  apply buttons shipped once already.',
  ].join('\n');
}

/** How many removals to name before the block becomes a wall the reader skips. */
const MAX_NAMED_REMOVALS = 12;

/**
 * WHAT THIS RUN DELETED, AND WHY.
 *
 * The most important thing this renderer prints, because it is the only part of
 * the pipeline that removes something the candidate had already qualified for.
 * Every other section reports what was found; this one reports what was taken
 * away, and a deletion the user is not told about is indistinguishable from a
 * bug.
 *
 * Three things have to be here, and each is here for a reason that was learned
 * the hard way somewhere else in this codebase:
 *
 *   THE COUNT AND THE NAMES. `renderExcludedTable` already exists because a
 *   filter the candidate cannot inspect is a filter he cannot argue with. The
 *   same applies twice over to a removal, so each deleted posting is named with
 *   the status that condemned it.
 *
 *   THE RULE. Printed beside the removals rather than buried in `--help`, so
 *   the reader can check the judgement against the evidence in front of him
 *   instead of taking "provably gone" on trust.
 *
 *   THE FAILURE MODE, kept distinct. "Nothing was removed" reads identically
 *   whether every posting is healthy or the checker never reached the network.
 *   `persist-queue.ts` draws exactly this distinction between a real empty
 *   result and a failed run, for exactly this reason.
 *
 * Returns `null` rather than an empty string so a caller cannot print a blank
 * line where a report was supposed to be.
 */
export function renderLivenessReport(queue: JobQueue): string | null {
  const liveness = queue.liveness;
  // Absent means this queue predates the feature; `off` means the user opted
  // out. Neither is worth a line, and a "0 removed" printed on every offline
  // run is how a section stops being read.
  if (liveness === undefined || liveness.status === 'off') {
    return null;
  }

  if (liveness.status === 'failed') {
    return [
      `Link liveness: the check could not run (${liveness.error ?? 'unknown error'}).`,
      '  NOTHING was removed. An unreachable checker is not evidence that a vacancy has',
      '  closed, so every posting below is exactly as the filters left it.',
    ].join('\n');
  }

  const lines = [
    `Link liveness: ${liveness.checked} checked ` +
      `(${liveness.fromCache} from cache, ${liveness.requests} request${
        liveness.requests === 1 ? '' : 's'
      }), ${liveness.alive} reachable.`,
  ];

  if (liveness.unverified > 0) {
    /*
     * Stated plainly and WITHOUT alarm. These are overwhelmingly bot-protected
     * career sites answering 403, or a server that hung up - ordinary, frequent,
     * and not the reader's problem. Dressing them as warnings would drown the
     * line above them that occasionally means something.
     */
    lines.push(
      `  ${liveness.unverified} could not be verified (bot protection, a timeout, a reset ` +
        'or a redirect) and were KEPT, marked as unverified.',
    );
  }

  if (liveness.removed === 0) {
    lines.push('  Nothing was removed: no posting answered 404 or 410.');
    return lines.join('\n');
  }

  const removed = queue.excluded.filter((entry) => entry.excludedBy === 'dead_link');
  const named = removed.slice(0, MAX_NAMED_REMOVALS);
  const rest = removed.length - named.length;

  lines.push(
    '',
    `  ${liveness.removed} posting${liveness.removed === 1 ? '' : 's'} REMOVED as provably gone:`,
  );
  for (const entry of named) {
    // The status is inside `reason`, which the domain wrote. Reprinting the
    // domain's sentence rather than re-deriving one here keeps the terminal and
    // the persisted audit trail saying the same thing.
    lines.push(`    - "${entry.title}" — ${entry.company}`);
    lines.push(`        ${entry.reason}`);
    lines.push(`        ${entry.url}`);
  }
  if (rest > 0) {
    lines.push(`    ...and ${rest} more, all listed in the excluded table below.`);
  }

  lines.push(
    '',
    '  They are NOT gone from the run: every one is in the excluded table below,',
    '  beside the postings the two content filters removed, with the score it would',
    '  have had. A removal you cannot inspect is a removal you cannot trust.',
    '',
    '  Only HTTP 404 and 410 remove a posting. 403 and 401 (bot protection, login',
    '  walls), 429 (we asked too often), every 3xx, every 5xx, timeouts, connection',
    '  resets and DNS failures all KEEP it: a dead link you click past costs five',
    '  seconds, and a real vacancy deleted here would be invisible.',
  );

  return lines.join('\n');
}

/** Run metadata: what was fetched, what was deduped, what broke. */
export function renderRunSummary(queue: JobQueue): string {
  const failed = queue.sourceReports.filter((report) => report.status === 'failed');
  const applied = queue.jobs.filter((entry) => entry.applicationStatus !== 'not_applied').length;

  /*
   * `totalJuniorEligible` counts what passed the two CONTENT filters, which is
   * measured before any dead posting is removed. Printing it raw here would
   * read "Showing 127 of 131" and imply an explicit --limit was hiding four
   * offers, when in fact four addresses stopped answering. The removals get
   * their own report; this line must not double-count them as truncation.
   */
  const removedAsDead = queue.excluded.filter((entry) => entry.excludedBy === 'dead_link').length;
  const available = queue.totalJuniorEligible - removedAsDead;

  const lines = [
    `Generated at ${queue.generatedAt} for ${queue.candidate}`,
    `Fetched ${queue.totalFetched} postings, ${queue.totalUnique} unique (${queue.duplicatesRemoved} duplicates collapsed)`,
    // Both numbers, always. If they differ, an explicit --limit is hiding
    // offers, and the candidate is entitled to know how many.
    `Showing ${queue.jobs.length} of ${available} offers, newest first`,
  ];

  const contributions = renderSourceContributions(queue);
  if (contributions !== null) {
    lines.push(contributions);
  }

  if (queue.excluded.length > 0) {
    const notTech = queue.excluded.filter(
      (entry) => entry.excludedBy === 'software_relevance',
    ).length;
    const countOf = (code: ExcludedEntry['excludedBy']): number =>
      queue.excluded.filter((entry) => entry.excludedBy === code).length;
    const notLocal = countOf('location_incompatible');
    const tooExperienced = countOf('experience_over_limit');
    const tooSenior = countOf('seniority_excluded');
    // Legacy queues carry the pre-split verdict; it still reads as "not junior".
    const notJunior = countOf('junior_eligibility') + tooExperienced + tooSenior;
    // The dead-link count is reported separately rather than folded in, because
    // it is not a filter verdict: those postings qualified and then vanished.
    lines.push(
      `Filtered out ${notTech + notJunior + notLocal} of ${queue.totalUnique}: ` +
        `${notTech} not software, ${notLocal} outside Madrid/remote-from-Spain, ` +
        `${tooExperienced} asking for over 2 years, ${tooSenior} senior/lead/manager` +
        (countOf('junior_eligibility') === 0 ? '' : `, ${countOf('junior_eligibility')} not junior-eligible`) +
        (removedAsDead === 0 ? '' : `; plus ${removedAsDead} removed as gone (404/410)`),
    );
  }
  if (applied > 0) {
    lines.push(`${applied} of the shown entries were already applied to`);
  }

  const outages = renderBoardOutages(queue);
  if (outages !== null) {
    lines.push(outages);
  }

  if (failed.length > 0) {
    lines.push(`Degraded run: ${failed.length} source query/queries failed:`);
    for (const report of failed) {
      lines.push(`  - ${report.sourceId} "${report.query}": ${report.error ?? 'unknown error'}`);
    }
  }

  return lines.join('\n');
}
