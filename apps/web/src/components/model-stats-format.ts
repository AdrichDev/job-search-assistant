import type { ApplicationStats } from '@job-queue/core/domain';
import { resolveModel, type ModelCatalog } from '@/server/model-catalog';

/** Rows of the "Por modelo de CV" table: stored ids resolved to names (dangling -> Spanish fallback). */
export interface ModelStatsRow {
  readonly key: string;
  readonly label: string;
  readonly applied: number;
  readonly responses: number;
  readonly responseRate: number;
  readonly advances: number;
}

export function buildModelStatsRows(
  byModel: ApplicationStats['byModel'],
  catalog: ModelCatalog,
): ModelStatsRow[] {
  return byModel.map((row) => ({
    key: row.modelId,
    label: resolveModel(catalog, row.modelId).text,
    applied: row.applied,
    responses: row.responses,
    responseRate: row.responseRate,
    advances: row.advances,
  }));
}
