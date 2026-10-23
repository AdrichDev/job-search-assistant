import type { Metadata } from 'next';
import { AnalysisCharts } from '@/components/analysis-charts';
import { StatsPanel } from '@/components/stats-panel';
import { ES } from '@/copy/es';
import {
  applicationRepository,
  buildFallbackQueue,
  cvModelRepository,
  dismissalRepository,
  queueReader,
} from '@/server/container';
import { loadDashboard } from '@/server/dashboard';
import { loadModelCatalog } from '@/server/model-catalog';

/**
 * The analysis view (S9): the results of the applications, the CV versions,
 * the sources and the charts generated from them, in their own view instead of
 * above the offer list. The data path is the one the home page already used -
 * the same dashboard load, so a chart can never disagree with the tables.
 */

// The application log changes on every click, so a cached page would show the
// candidate a stale picture of their own results.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: ES.analysis.meta.title,
  description: ES.analysis.meta.description,
};

export default async function AnalysisPage() {
  const dashboard = await loadDashboard({
    queueReader: queueReader(),
    applicationRepository: applicationRepository(),
    dismissalRepository: dismissalRepository(),
    buildFallbackQueue,
    now: () => new Date(),
  });

  // Read once, and only when some application names a model: the stats table needs names.
  const modelCatalog = await loadModelCatalog(
    dashboard.stats.byModel.length > 0 ? cvModelRepository() : undefined,
  );

  return (
    <main id="analisis" className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {ES.analysis.heading}
        </h1>
        <p className="prose-measure mt-2 text-sm leading-relaxed text-slate-600">
          {ES.analysis.intro}
        </p>
      </header>

      <StatsPanel stats={dashboard.stats} models={modelCatalog} />

      <AnalysisCharts stats={dashboard.stats} models={modelCatalog} />
    </main>
  );
}
