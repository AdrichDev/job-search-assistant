import type { ApplicationOutcome, ApplicationStats } from '@job-queue/core/domain';
import {
  barLength,
  funnelStages,
  percentLabel,
  type ChartRow,
  type FunnelKey,
} from '@/lib/analysis-charts';
import { buildModelStatsRows } from '@/components/model-stats-format';
import { ES, cvVariantLabel } from '@/copy/es';
import { EMPTY_CATALOG, type ModelCatalog } from '@/server/model-catalog';

/**
 * The diagrams of /analisis (S9): bars generated from the SAME data the stats
 * panel reads, not a second aggregation.
 *
 * ## Why CSS bars and not an SVG image
 *
 * Every row prints its value as text next to its bar, so the chart IS its own
 * readable fallback and nothing is said by colour alone - the numbers survive
 * greyscale, a stopped animation and a screen reader alike. The bars are the
 * only decoration, marked `aria-hidden`.
 *
 * The bar hues are the same explicit values the metric cards use: the theme
 * mirror would otherwise turn Tailwind colour classes into surfaces.
 */

/**
 * One hue per funnel stage, keyed by the STAGE, not by its position: the panel's
 * order can change without silently repainting the funnel, and a stage added in
 * the middle does not steal its neighbour's colour.
 */
const FUNNEL_TONES: Record<FunnelKey, string> = {
  surfaced: '#6366f1',
  applied: '#9d00ff',
  responses: '#d946ef',
  advances: '#ff9900',
  interviews: '#00f0ff',
  offers: '#84cc16',
};

const DEFAULT_TONE = '#6366f1';

/** Outcomes in reading order: what happened after applying, no-reply last like the odd one out. */
const OUTCOME_ORDER: readonly ApplicationOutcome[] = [
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'no_reply',
];

function BarChart({
  title,
  rows,
  emptyNote,
  tones,
}: {
  readonly title: string;
  readonly rows: readonly ChartRow[];
  readonly emptyNote?: string;
  readonly tones?: Readonly<Record<string, string>>;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <figure className="mt-6">
      {/*
       * A caption, not a heading: every chart repeats a metric the panel above
       * already names, and two headings with the same text on one page make the
       * document outline lie to a screen reader (and make a role query ambiguous).
       * The caption is also the figure's accessible name, which is why there is
       * no second, hidden readout: the list below already exposes every row with
       * its value, and restating them verbatim meant reading the chart twice.
       */}
      <figcaption className="mb-2 text-sm font-semibold text-slate-800">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="prose-measure rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-600">
          {emptyNote}
        </p>
      ) : (
        <ul role="list" aria-label={title} className="space-y-2.5">
          {rows.map((row) => {
            const width = `${barLength(row.value, max, 100)}%`;
            const valueText = row.value + (row.detail === undefined ? '' : ` · ${row.detail}`);
            return (
              <li
                key={row.key}
                className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_1fr_13rem]"
              >
                <span className="truncate text-xs text-slate-600 sm:text-sm" title={row.label}>
                  {row.label}
                </span>
                <span className="text-right text-xs tabular-nums text-slate-700 sm:hidden">
                  {valueText}
                </span>
                <span
                  aria-hidden="true"
                  className="relative col-span-2 h-4 rounded bg-slate-100 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                  title={valueText}
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded"
                    style={{ width, backgroundColor: tones?.[row.key] ?? DEFAULT_TONE }}
                  />
                </span>
                <span className="hidden text-right text-xs tabular-nums text-slate-600 sm:col-start-3 sm:row-start-1 sm:block">
                  {valueText}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}

/**
 * Every chart on the page, each built from one slice of `ApplicationStats`.
 * The breakdown charts reuse the source/model/variant tables the panel shows:
 * those tables are their fallback, so the chart adds no second copy of the rows.
 */
export function AnalysisCharts({
  stats,
  models = EMPTY_CATALOG,
}: {
  stats: ApplicationStats;
  /** The model registry, read once per page load; ids become names, removed ones a fallback. */
  models?: ModelCatalog;
}) {
  const funnelRows: readonly ChartRow[] = funnelStages(stats.funnel).map((stage) => ({
    key: stage.key,
    label: {
      surfaced: ES.stats.surfaced,
      applied: ES.stats.applied,
      responses: ES.stats.responses,
      advances: ES.stats.advanced,
      interviews: ES.stats.interviews,
      offers: ES.stats.offers,
    }[stage.key],
    value: stage.count,
    ...(stage.rateFromPrevious === null
      ? {}
      : { detail: ES.analysis.stageDetail(percentLabel(stage.rateFromPrevious)) }),
  }));

  const outcomeRows: readonly ChartRow[] = OUTCOME_ORDER.map((outcome) => ({
    key: outcome,
    label: ES.outcomeOption[outcome],
    value: stats.byOutcome[outcome],
  }));

  const sourceRows: readonly ChartRow[] = stats.bySource.map((row) => ({
    key: row.sourceId,
    label: row.sourceId === 'unknown' ? ES.stats.unknownSource : row.sourceId,
    value: row.applied,
    detail: ES.analysis.responseDetail(percentLabel(row.responseRate)),
  }));

  const modelRows: readonly ChartRow[] = buildModelStatsRows(stats.byModel, models).map((row) => ({
    key: row.key,
    // The full name stays in the DOM: CSS cuts it visually, so a screen reader
    // and the sr-only summary read the whole thing instead of an ellipsis.
    label: row.label,
    value: row.applied,
    detail: ES.analysis.responseDetail(percentLabel(row.responseRate)),
  }));

  const variantRows: readonly ChartRow[] = stats.byVariant.map((row) => ({
    key: row.cvVariant,
    label: cvVariantLabel(row.cvVariant),
    value: row.applied,
    detail: ES.analysis.responseDetail(percentLabel(row.responseRate)),
  }));

  return (
    <section aria-labelledby="charts-heading" className="mt-10">
      <h2
        id="charts-heading"
        className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        {ES.analysis.chartsHeading}
      </h2>
      <p className="prose-measure mb-4 text-xs leading-relaxed text-slate-500">
        {ES.analysis.chartsIntro}
      </p>

      <BarChart
        title={ES.stats.funnelHeading}
        rows={funnelRows}
        tones={FUNNEL_TONES}
      />
      <BarChart
        title={ES.analysis.outcomesHeading}
        rows={outcomeRows}
        emptyNote={ES.stats.empty}
      />
      <BarChart
        title={ES.stats.bySourceHeading}
        rows={sourceRows}
        emptyNote={ES.analysis.noSources}
      />
      <BarChart
        title={ES.stats.byModelHeading}
        rows={modelRows}
        emptyNote={ES.analysis.noModelsYet}
      />
      <BarChart
        title={ES.stats.byVariantHeading}
        rows={variantRows}
        emptyNote={ES.analysis.noVariants}
      />

      <p className="prose-measure mt-4 text-xs leading-relaxed text-slate-500">
        {ES.analysis.chartFallback}
      </p>
    </section>
  );
}
