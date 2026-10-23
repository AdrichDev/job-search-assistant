import type { ApplicationStats } from '@job-queue/core/domain';
import { buildModelStatsRows } from '@/components/model-stats-format';
import { ES, cvVariantLabel } from '@/copy/es';
import { EMPTY_CATALOG, type ModelCatalog } from '@/server/model-catalog';

/**
 * The payoff panel: "does my Microsoft CV convert better than my React one?".
 *
 * Rates are shown next to their raw counts on purpose. "100% de respuesta" over
 * two applications is noise, and hiding the denominator would let the candidate
 * act on it as if it were a finding.
 */

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * One hue per metric.
 *
 * The user's complaint about the redesign was precise: "todas las sections o
 * cards tienen el mismo color azul". A funnel is a sequence, so the colour is a
 * position: indigo where offers enter, through violet, fuchsia and orange, to
 * lime at the end. The hues are explicit values because the theme mirror would
 * otherwise turn them into surfaces.
 */
const TONES = {
  indigo: { rail: 'from-[#6366f1] to-[#818cf8]', value: 'text-[#a5b4fc]' },
  violet: { rail: 'from-[#9d00ff] to-[#c084fc]', value: 'text-[#d8b4fe]' },
  fuchsia: { rail: 'from-[#d946ef] to-[#f0abfc]', value: 'text-[#f5d0fe]' },
  orange: { rail: 'from-[#ff9900] to-[#fdba74]', value: 'text-[#fed7aa]' },
  cyan: { rail: 'from-[#00f0ff] to-[#67e8f9]', value: 'text-[#a5f3fc]' },
  lime: { rail: 'from-[#84cc16] to-[#bef264]', value: 'text-[#d9f99d]' },
} as const;

type Tone = keyof typeof TONES;

function Metric({
  label,
  value,
  hint,
  tone = 'indigo',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  const hue = TONES[tone];
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${hue.rail}`} />
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-2xl font-bold tabular-nums ${hue.value}`}>{value}</dd>
      {hint !== undefined && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

interface ConversionRow {
  readonly key: string;
  readonly label: string;
  readonly applied: number;
  readonly responses: number;
  readonly responseRate: number;
  readonly advances: number;
}

function ConversionTable({
  heading,
  caption,
  firstColumn,
  rows,
}: {
  readonly heading: string;
  readonly caption: string;
  readonly firstColumn: string;
  readonly rows: readonly ConversionRow[];
}) {
  return (
    <>
      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-800">{heading}</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">{firstColumn}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{ES.stats.columnApplied}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{ES.stats.columnResponses}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{ES.stats.columnResponseRate}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{ES.stats.columnAdvanced}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="px-4 py-2.5 font-medium text-slate-800">{row.label}</th>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{row.applied}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{row.responses}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{percent(row.responseRate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{row.advances}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function StatsPanel({
  stats,
  models = EMPTY_CATALOG,
}: {
  stats: ApplicationStats;
  /** The model registry, read once per page load; ids become names, removed ones a fallback. */
  models?: ModelCatalog;
}) {
  const modelRows = buildModelStatsRows(stats.byModel, models);
  const modelApplied = stats.byModel.reduce((sum, row) => sum + row.applied, 0);
  return (
    <section aria-labelledby="stats-heading" className="mb-10">
      <h2
        id="stats-heading"
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        {ES.stats.heading}
      </h2>

      <h3 className="mb-2 text-sm font-semibold text-slate-800">{ES.stats.funnelHeading}</h3>
      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label={ES.stats.surfaced} value={String(stats.funnel.surfaced)} tone="indigo" />
        <Metric
          label={ES.stats.applied}
          tone="violet"
          value={String(stats.funnel.applied)}
          hint={ES.stats.stageRate(percent(stats.funnel.applicationRate))}
        />
        <Metric
          label={ES.stats.responses}
          tone="fuchsia"
          value={String(stats.funnel.responses)}
          hint={ES.stats.stageRate(percent(stats.funnel.responseRate))}
        />
        <Metric
          label={ES.stats.advanced}
          tone="orange"
          value={String(stats.funnel.advances)}
          hint={ES.stats.stageRate(percent(stats.funnel.advanceRate))}
        />
        <Metric
          label={ES.stats.interviews}
          tone="cyan"
          value={String(stats.funnel.interviews)}
          hint={ES.stats.stageRate(percent(stats.funnel.interviewRate))}
        />
        <Metric
          label={ES.stats.offers}
          tone="lime"
          value={String(stats.funnel.offers)}
          hint={ES.stats.stageRate(percent(stats.funnel.offerRate))}
        />
      </dl>

      {stats.totalApplied === 0 ? (
        <p className="prose-measure rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
          {ES.stats.empty}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label={ES.stats.applied} value={String(stats.totalApplied)} tone="violet" />
            <Metric
              label={ES.stats.responseRate}
              tone="fuchsia"
              value={percent(stats.responseRate)}
              hint={ES.stats.responseHint(stats.responses, stats.totalApplied)}
            />
            <Metric
              label={ES.stats.advanced}
              tone="orange"
              value={percent(stats.advanceRate)}
              hint={ES.stats.advancedHint(stats.advances)}
            />
            <Metric label={ES.stats.pending} value={String(stats.pending)} tone="cyan" />
          </dl>

          {modelRows.length === 0 ? (
            <>
              <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-800">{ES.stats.byModelHeading}</h3>
              <p className="prose-measure rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-600">
                {ES.stats.noModelsYet}
              </p>
            </>
          ) : (
            <>
              <ConversionTable
                heading={ES.stats.byModelHeading}
                caption={ES.stats.modelTableCaption}
                firstColumn={ES.stats.columnModel}
                rows={modelRows}
              />
              {modelApplied < 10 && (
                <p className="prose-measure mt-2 text-xs leading-relaxed text-slate-500">
                  {ES.stats.smallModelSample}
                </p>
              )}
            </>
          )}

          <ConversionTable
            heading={ES.stats.byVariantHeading}
            caption={ES.stats.variantTableCaption}
            firstColumn={ES.stats.columnVariant}
            rows={stats.byVariant.map((row) => ({
              key: row.cvVariant,
              label: cvVariantLabel(row.cvVariant),
              ...row,
            }))}
          />

          <ConversionTable
            heading={ES.stats.bySourceHeading}
            caption={ES.stats.sourceTableCaption}
            firstColumn={ES.stats.columnSource}
            rows={stats.bySource.map((row) => ({
              key: row.sourceId,
              label: row.sourceId === 'unknown' ? ES.stats.unknownSource : row.sourceId,
              ...row,
            }))}
          />

          {stats.totalApplied < 10 && (
            <p className="prose-measure mt-2 text-xs leading-relaxed text-slate-500">
              {ES.stats.smallSample}
            </p>
          )}
        </>
      )}
    </section>
  );
}
