import type { ApplicationStats } from '@job-queue/core/domain';
import { ES, cvVariantLabel } from '@/copy/es';

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

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      {hint !== undefined && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function StatsPanel({ stats }: { stats: ApplicationStats }) {
  return (
    <section aria-labelledby="stats-heading" className="mb-10">
      <h2
        id="stats-heading"
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        {ES.stats.heading}
      </h2>

      {stats.totalApplied === 0 ? (
        <p className="prose-measure rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
          {ES.stats.empty}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label={ES.stats.applied} value={String(stats.totalApplied)} />
            <Metric
              label={ES.stats.responseRate}
              value={percent(stats.responseRate)}
              hint={ES.stats.responseHint(stats.responses, stats.totalApplied)}
            />
            <Metric
              label={ES.stats.advanced}
              value={percent(stats.advanceRate)}
              hint={ES.stats.advancedHint(stats.advances)}
            />
            <Metric label={ES.stats.pending} value={String(stats.pending)} />
          </dl>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-800">
            {ES.stats.byVariantHeading}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{ES.stats.tableCaption}</caption>
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {ES.stats.columnVariant}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    {ES.stats.columnApplied}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    {ES.stats.columnResponses}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    {ES.stats.columnResponseRate}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    {ES.stats.columnAdvanced}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.byVariant.map((row) => (
                  <tr key={row.cvVariant}>
                    <th scope="row" className="px-4 py-2.5 font-medium text-slate-800">
                      {cvVariantLabel(row.cvVariant)}
                    </th>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {row.applied}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {row.responses}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {percent(row.responseRate)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {row.advances}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
