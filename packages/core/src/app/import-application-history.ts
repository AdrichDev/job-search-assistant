import { createHash } from 'node:crypto';
import type { ApplicationOutcome } from '../domain/application.js';
import type { ApplicationRepository } from '../ports/application-repository.js';
import type { HistoryRow } from '../ports/history-reader.js';

/**
 * Imports the user's historical spreadsheet rows into the application log.
 *
 * Idempotent: the job id is a hash of the row's identifying fields, and the
 * repository ignores a job id it already holds. Rows are never invented or
 * guessed: anything unmappable is skipped and reported by row number.
 */

export interface ImportApplicationHistoryDeps {
  readonly repository: ApplicationRepository;
}

export interface SkippedRow {
  readonly rowNumber: number;
  readonly reason: string;
}

export interface ImportApplicationHistoryResult {
  readonly imported: number;
  readonly alreadyImported: number;
  readonly skipped: readonly SkippedRow[];
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
  const skipped: SkippedRow[] = [];

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

  return { imported, alreadyImported, skipped };
}
