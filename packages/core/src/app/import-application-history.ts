import { createHash } from 'node:crypto';
import { isResponse, type Application, type ApplicationOutcome } from '../domain/application.js';
import { diffApplications } from '../domain/application-history.js';
import type { ApplicationHistoryRepository } from '../ports/application-history-repository.js';
import type { ApplicationRepository } from '../ports/application-repository.js';
import type { HistoryRow } from '../ports/history-reader.js';

/**
 * Imports the user's historical spreadsheet rows into the application log.
 *
 * Idempotent: the job id is a hash of the row's identifying fields, and the
 * repository ignores a job id it already holds. Rows are never invented or
 * guessed: anything unmappable is skipped and reported by row number.
 *
 * A row that describes an application already in the log (made from the queue)
 * is not imported a second time. It matches on normalized company and title with
 * applied dates within one day, and each existing application absorbs at most one
 * row. The spreadsheet may then supply the state, but only to an application that
 * has no response yet: a response recorded in the app is never replaced, and a
 * recorded response is never turned back into "no answer".
 */

export interface ImportApplicationHistoryDeps {
  readonly repository: ApplicationRepository;
  /**
   * When present, each existing application whose state the spreadsheet updated
   * gets a history entry (source `import`). The creation of imported rows is not
   * logged: the rows themselves are the record.
   */
  readonly history?: ApplicationHistoryRepository;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface SkippedRow {
  readonly rowNumber: number;
  readonly reason: string;
}

export interface ImportApplicationHistoryResult {
  readonly imported: number;
  readonly alreadyImported: number;
  /** Rows that describe an application already in the log and were not imported again. */
  readonly matchedExisting: number;
  /** Of those, how many had their state updated from the spreadsheet. */
  readonly updatedExisting: number;
  readonly skipped: readonly SkippedRow[];
  /** Present only when some update was saved but its history entry could not be written. */
  readonly historyFailures?: number;
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function importJobId(row: HistoryRow, appliedAt: Date): string {
  const key = [row.company, row.title, dayOf(appliedAt), row.listNumber].map(normalize).join('|');
  return `import-${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

/** `InfoJobs` -> `infojobs`, `Web de la empresa` -> `web-de-la-empresa`. */
export function slugPortal(portal: string): string {
  return portal
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function matchKey(company: string, title: string): string {
  return `${slugPortal(company)}|${slugPortal(title)}`;
}

/** Applications made from the queue, by `company|title`. Imported ones never match. */
function indexQueueApplications(applications: readonly Application[]): Map<string, Application[]> {
  const index = new Map<string, Application[]>();
  for (const application of applications) {
    if (application.jobId.startsWith('import-')) {
      continue;
    }
    const [company, title] = application.jobId.split('::');
    if (company === undefined || title === undefined) {
      continue;
    }
    const key = matchKey(company, title);
    index.set(key, [...(index.get(key) ?? []), application]);
  }
  return index;
}

function withinOneDay(a: Date, b: Date): boolean {
  return Math.abs(Date.parse(dayOf(a)) - Date.parse(dayOf(b))) <= ONE_DAY_MS;
}

function outcomeFor(row: HistoryRow): ApplicationOutcome | undefined {
  const status = normalize(row.status);
  if (status === 'rechazado') {
    return 'rejected';
  }
  if (status === 'en proceso') {
    const replied = slugPortal(row.replied);
    if (replied === 'no') {
      return 'applied';
    }
    if (replied === 'si') {
      return 'screening';
    }
  }
  return undefined;
}

function httpUrlOrUndefined(value: string): string | undefined {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export async function importApplicationHistory(
  rows: readonly HistoryRow[],
  deps: ImportApplicationHistoryDeps,
): Promise<ImportApplicationHistoryResult> {
  let imported = 0;
  let alreadyImported = 0;
  let matchedExisting = 0;
  let updatedExisting = 0;
  let historyFailures = 0;
  const skipped: SkippedRow[] = [];
  const queueApplications = indexQueueApplications(await deps.repository.list());

  for (const row of rows) {
    if (row.appliedAt === undefined) {
      skipped.push({ rowNumber: row.rowNumber, reason: 'missing_applied_date' });
      continue;
    }
    const outcome = outcomeFor(row);
    if (outcome === undefined) {
      skipped.push({ rowNumber: row.rowNumber, reason: 'unsupported_status_or_reply' });
      continue;
    }

    const candidates = queueApplications.get(matchKey(row.company, row.title)) ?? [];
    const matchIndex = candidates.findIndex((candidate) => withinOneDay(candidate.appliedAt, row.appliedAt as Date));
    const match = matchIndex === -1 ? undefined : candidates[matchIndex];
    if (match !== undefined) {
      candidates.splice(matchIndex, 1);
      matchedExisting += 1;
      if (isResponse(outcome) && !isResponse(match.outcome)) {
        const updated = await deps.repository.updateOutcome({
          jobId: match.jobId,
          outcome,
          at: row.respondedAt ?? match.outcomeUpdatedAt,
        });
        updatedExisting += 1;
        if (deps.history !== undefined && updated !== null) {
          const changes = diffApplications(match, updated);
          if (changes.length > 0) {
            try {
              await deps.history.append({
                id: (deps.newId ?? (() => globalThis.crypto.randomUUID()))(),
                jobId: match.jobId,
                at: (deps.now ?? (() => new Date()))(),
                source: 'import',
                changes,
              });
            } catch {
              historyFailures += 1;
            }
          }
        }
      }
      continue;
    }

    const portalSlug = slugPortal(row.portal);
    const url = httpUrlOrUndefined(row.url);

    try {
      const { created } = await deps.repository.record({
        jobId: importJobId(row, row.appliedAt),
        appliedAt: row.appliedAt,
        outcome,
        ...(row.respondedAt === undefined ? {} : { outcomeUpdatedAt: row.respondedAt }),
        sourceIds: portalSlug.length === 0 ? [] : [portalSlug],
        listing: {
          company: row.company,
          title: row.title,
          ...(url === undefined ? {} : { url }),
          portal: row.portal,
          city: row.city,
          address: row.address,
          phone: row.phone,
          contact: row.contact,
          companyInfo: row.companyInfo,
          ...(row.publishedAt === undefined ? {} : { publishedAt: row.publishedAt }),
        },
      });
      if (created) {
        imported += 1;
      } else {
        alreadyImported += 1;
      }
    } catch {
      // The domain refused the row (e.g. a blank title). Its message could quote
      // cell content, so only a fixed reason is reported.
      skipped.push({ rowNumber: row.rowNumber, reason: 'rejected_by_domain' });
    }
  }

  return {
    imported,
    alreadyImported,
    matchedExisting,
    updatedExisting,
    skipped,
    ...(historyFailures > 0 ? { historyFailures } : {}),
  };
}
