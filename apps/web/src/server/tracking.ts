import 'server-only';

import {
  buildTrackedApplications,
  countByOutcome,
  isApplicationOutcome,
  type Application,
  type ApplicationOutcome,
  type ApplicationRepository,
  type CvModelRepository,
  type CvVariant,
  type QueueReader,
  type TrackedApplication,
  type TrackableQueueJob,
} from '@job-queue/core';
import { loadModelCatalog, type ModelCatalog, EMPTY_CATALOG } from '@/server/model-catalog';

/**
 * Read model of the tracking view (`/seguimiento`). Read-only on purpose: it
 * never writes the application log, the queue or the dismissals.
 */

export type EstadoFilter = ApplicationOutcome | 'all';

/** A non-fatal read problem. Structured so the UI words it in Spanish. */
export interface TrackingWarning {
  readonly kind: 'applications' | 'queue' | 'models';
  readonly detail: string;
}

export interface TrackingData {
  /** Every application, newest first. Filtering is a separate, pure step. */
  readonly rows: readonly TrackedApplication[];
  readonly counts: Readonly<Record<ApplicationOutcome, number>>;
  readonly warnings: readonly TrackingWarning[];
  /** The documents each application used, by job id (the table shows them in one column). */
  readonly documents: ReadonlyMap<string, DocumentRefs>;
  /** The model registry, read once for the whole page. */
  readonly catalog: ModelCatalog;
}

/** What one application says about the documents it used. Only keys that have a value. */
export interface DocumentRefs {
  readonly cvVariant?: CvVariant;
  readonly cvModelId?: string;
  readonly letterModelId?: string;
}

export interface TrackingDeps {
  readonly applicationRepository: ApplicationRepository;
  readonly queueReader: QueueReader;
  /** Optional: without it model references are listed without names. */
  readonly cvModelRepository?: CvModelRepository;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `?estado=` is user-controlled: anything that is not an outcome means "all". */
export function parseEstadoFilter(raw: string | readonly string[] | undefined): EstadoFilter {
  return typeof raw === 'string' && isApplicationOutcome(raw) ? raw : 'all';
}

export function filterTrackedRows(
  rows: readonly TrackedApplication[],
  filter: EstadoFilter,
): readonly TrackedApplication[] {
  return filter === 'all' ? rows : rows.filter((row) => row.outcome === filter);
}

/** UI-2: the user asked for exactly 10 rows per page. */
export const TRACKING_PAGE_SIZE = 10;

/**
 * `?pagina=` is user-controlled: anything that is not a finite positive integer
 * means page 1. Arrays count as absent (the page only ever sends a scalar),
 * and a value beyond the double range (`1e999`) is not a finite integer. A
 * merely huge but finite value (say `1e21`) survives and is clamped later by
 * `paginateRows`, which is where range correctness lives.
 */
export function parsePagina(raw: string | readonly string[] | undefined): number {
  if (typeof raw !== 'string') {
    return 1;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export interface PaginatedRows {
  /** Only the rows of the current page, in the given order. */
  readonly rows: readonly TrackedApplication[];
  readonly page: number;
  /** Always >= 1, even for an empty list. */
  readonly totalPages: number;
  readonly total: number;
  /** 1-based inclusive range of the rows shown; 0–0 when the list is empty. */
  readonly from: number;
  readonly to: number;
}

/** Slices the ALREADY-FILTERED rows; the caller filters first, paginates second. */
export function paginateRows(
  rows: readonly TrackedApplication[],
  page: number,
): PaginatedRows {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / TRACKING_PAGE_SIZE));
  const current = Math.min(Math.max(Math.trunc(page) || 1, 1), totalPages);
  const start = (current - 1) * TRACKING_PAGE_SIZE;
  const visible = rows.slice(start, start + TRACKING_PAGE_SIZE);

  return {
    rows: visible,
    page: current,
    totalPages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + visible.length,
  };
}

export interface EditableApplication {
  readonly application: Application;
  /** What the tracking table shows for it: company/title even without a listing. */
  readonly row: TrackedApplication | undefined;
}

/** The URL param may or may not arrive decoded; a stray `%` must not crash the page. */
export function decodeJobIdParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** One application plus its tracked row, or null when the id is unknown. */
export async function loadEditableApplication(
  jobId: string,
  deps: TrackingDeps,
): Promise<EditableApplication | null> {
  const application = await deps.applicationRepository.findByJobId(jobId);
  if (application === null) {
    return null;
  }
  let jobs: readonly TrackableQueueJob[] = [];
  try {
    jobs = (await deps.queueReader.read())?.jobs ?? [];
  } catch {
    // A broken queue only costs the pre-filled facts of a queue-made application.
  }
  const row = buildTrackedApplications([application], jobs)[0];
  return { application, row };
}

export async function loadTracking(deps: TrackingDeps): Promise<TrackingData> {
  const warnings: TrackingWarning[] = [];

  // A broken queue only costs the title/link of applications whose job is still
  // queued; the log itself carries enough to list everything else.
  let jobs: readonly TrackableQueueJob[] = [];
  try {
    jobs = (await deps.queueReader.read())?.jobs ?? [];
  } catch (cause: unknown) {
    warnings.push({ kind: 'queue', detail: describe(cause) });
  }

  let rows: readonly TrackedApplication[] = [];
  const documents = new Map<string, DocumentRefs>();
  try {
    const applications = await deps.applicationRepository.list();
    rows = buildTrackedApplications(applications, jobs);
    for (const application of applications) {
      const refs: DocumentRefs = {
        ...(application.cvVariant === undefined ? {} : { cvVariant: application.cvVariant }),
        ...(application.cvModelId === undefined ? {} : { cvModelId: application.cvModelId }),
        ...(application.letterModelId === undefined ? {} : { letterModelId: application.letterModelId }),
      };
      if (Object.keys(refs).length > 0) {
        documents.set(application.jobId, refs);
      }
    }
  } catch (cause: unknown) {
    warnings.push({ kind: 'applications', detail: describe(cause) });
  }

  // One registry read per page, and none when no application references a model.
  const anyModel = [...documents.values()].some(
    (refs) => refs.cvModelId !== undefined || refs.letterModelId !== undefined,
  );
  const catalog = anyModel ? await loadModelCatalog(deps.cvModelRepository) : EMPTY_CATALOG;
  if (catalog.unavailable) {
    // Fixed text only: the registry error can name a personal path.
    warnings.push({ kind: 'models', detail: '' });
  }

  return { rows, counts: countByOutcome(rows), warnings, documents, catalog };
}
