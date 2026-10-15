import type { ScoreBreakdownItem } from '@job-queue/core/domain';
import { ES, dimensionLabel } from '@/copy/es';

/**
 * Why this job ranks where it ranks.
 *
 * Non-negotiable product rule: the score is never an opaque number. A ranking
 * the candidate cannot argue with is a ranking they cannot correct, and the
 * whole tracking layer exists precisely to find out where it is wrong.
 *
 * Read as an EXPLANATION, not a dump. The old version showed value, weight,
 * points and reason as four equal numeric columns, which makes the reader do
 * the arithmetic before they can see the shape of the answer. Here the bar
 * carries the shape - "location is doing most of the work, seniority is
 * dragging" is legible in about a second - and the raw factors stay available
 * underneath the label for anyone who wants to check the multiplication.
 *
 * A native `<details>` element: expandable, keyboard-operable and screen-reader
 * friendly without a single line of JavaScript.
 */

/** Widest single contribution, so the bars are relative to the real maximum. */
function scaleOf(breakdown: readonly ScoreBreakdownItem[]): number {
  const widest = breakdown.reduce((max, item) => Math.max(max, Math.abs(item.contribution)), 0);
  return widest === 0 ? 1 : widest;
}

export function ScoreBreakdown({
  breakdown,
  total,
}: {
  breakdown: readonly ScoreBreakdownItem[];
  total: number;
}) {
  if (breakdown.length === 0) {
    return null;
  }

  const scale = scaleOf(breakdown);

  return (
    <details className="group mt-4 rounded-lg border border-slate-200 bg-slate-50/60">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 motion-reduce:transition-none"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        >
          <path d="m7 4 6 6-6 6" />
        </svg>
        {ES.score.summary(total.toFixed(1))}
      </summary>

      <div className="border-t border-slate-200 px-3 py-3">
        <p className="prose-measure mb-3 text-xs leading-relaxed text-slate-600">
          {ES.score.intro}
        </p>

        <table className="w-full border-separate border-spacing-y-1.5 text-left text-sm">
          <caption className="sr-only">{ES.score.tableCaption}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">{ES.score.columnDimension}</th>
              <th scope="col">{ES.score.columnContribution}</th>
              <th scope="col">{ES.score.columnReason}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((item) => {
              const width = Math.max(2, (Math.abs(item.contribution) / scale) * 100);
              const label = dimensionLabel(item.dimension);

              return (
                <tr key={item.dimension} className="align-top">
                  <th scope="row" className="w-40 pr-3 font-medium text-slate-800">
                    <span className="block">{label}</span>
                    <span className="block text-xs font-normal tabular-nums text-slate-500">
                      {ES.score.detail(item.value.toFixed(2), item.weight.toFixed(2))}
                    </span>
                  </th>

                  <td className="w-32 pr-3">
                    <span className="mb-1 block text-sm font-semibold tabular-nums text-slate-900">
                      {ES.score.points(item.contribution.toFixed(1))}
                    </span>
                    {/*
                      Purely decorative: the number above it is the accessible
                      value, so the bar is hidden from assistive technology
                      rather than repeated as noise.
                    */}
                    <span
                      aria-hidden="true"
                      className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
                    >
                      <span
                        className="block h-full rounded-full bg-indigo-500"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                  </td>

                  <td className="text-xs leading-relaxed text-slate-600">{item.reason}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200">
              <th scope="row" className="pt-2 pr-3 text-sm font-semibold text-slate-900">
                {ES.score.total}
              </th>
              <td className="pt-2 pr-3 text-sm font-semibold tabular-nums text-slate-900">
                {ES.score.points(total.toFixed(1))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  );
}
