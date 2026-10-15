/**
 * Public surface of the core package.
 *
 * `apps/web` imports from here and nowhere else, so the web app can never
 * reach into an internal module and quietly couple itself to a file path.
 *
 * Everything exported here is server-side. Nothing in this package is safe to
 * import from a browser bundle: the adapters touch `node:fs` and the config
 * reads credentials.
 */

/* Domain -------------------------------------------------------------- */
export {
  APPLICATION_OUTCOMES,
  createApplication,
  indexApplicationsByJobId,
  isAdvance,
  isApplicationOutcome,
  isResponse,
  withOutcome,
  type Application,
  type ApplicationDraft,
  type ApplicationOutcome,
} from './domain/application.js';

export {
  computeApplicationStats,
  type ApplicationStats,
  type VariantStats,
} from './domain/application-stats.js';

export {
  createDismissal,
  indexDismissalsByJobId,
  type Dismissal,
  type DismissalDraft,
} from './domain/dismissal.js';

export {
  extractRequirements,
  type EnglishRequirement,
  type JobRequirements,
  type SenioritySignal,
  type WorkMode,
} from './domain/requirements.js';

export { createJob, jobFingerprint, type CvVariant, type Job } from './domain/job.js';
export {
  SAMPLE_DATA_SOURCE_IDS,
  countSampleDataEntries,
  hasSampleDataSource,
  isSampleDataSourceId,
  type SourceAttributed,
} from './domain/sample-data.js';
export {
  auditPostingLinks,
  auditQueueLinks,
  describeLinkProblems,
  inspectPostingLink,
  isTitleDerived,
  type AuditableQueue,
  type LinkInspectionOptions,
  type LinkProblem,
  type LinkProblemRule,
  type PostingLink,
} from './domain/link-provenance.js';
export {
  GONE_STATUS_CODES,
  describeLivenessRemoval,
  isProvablyGone,
  judgeLiveness,
  type LinkCheckResult,
  type LivenessRecord,
  type LivenessVerdict,
} from './domain/link-liveness.js';
export { orderByRecency, scoreJobs } from './domain/order.js';
export {
  judgeJuniorEligibility,
  type JuniorEligibility,
  type JuniorFilterConfig,
} from './domain/junior-eligibility.js';
export {
  SCORE_DIMENSIONS,
  type ScoreBreakdownItem,
  type ScoreDimension,
  type ScoringConfig,
} from './domain/scoring/types.js';

/* Ports --------------------------------------------------------------- */
export type {
  ApplicationRepository,
  RecordResult,
  UpdateOutcomeInput,
} from './ports/application-repository.js';
export type {
  DismissResult,
  DismissalRepository,
} from './ports/dismissal-repository.js';
export type {
  JobSource,
  JobSourceQuery,
  JobSourceQueryMode,
  SourceTargetFailure,
} from './ports/job-source.js';
export type { PipelineRunner } from './ports/pipeline-runner.js';
export type {
  ClaimResult,
  FetchRunState,
  FetchRunSummary,
  RunClaim,
  RunStateStore,
} from './ports/run-state-store.js';
export type { LinkChecker, LinkCheckerStats } from './ports/link-checker.js';
export type { Logger } from './ports/logger.js';
export type { QueueReader } from './ports/queue-reader.js';
export type {
  ExcludedEntry,
  ExclusionFilter,
  JobQueue,
  LivenessSummary,
  QueueApplicationStatus,
  QueueEntry,
  QueueWriter,
  SourceReport,
} from './ports/queue-writer.js';

/* Application layer --------------------------------------------------- */
export { buildJobQueue, type BuildJobQueueDeps, type BuildJobQueueInput } from './app/build-job-queue.js';
export {
  statusFieldsFor,
  withApplicationStatus,
  type ApplicationStatusFields,
} from './app/application-status.js';
export {
  classifyRunHealth,
  decideQueueWrite,
  persistQueue,
  type ExistingQueueState,
  type PersistQueueDeps,
  type PersistQueueResult,
  type QueueWriteContext,
  type QueueWriteDecision,
  type RunHealth,
} from './app/persist-queue.js';
export {
  dismissJob,
  restoreJob,
  type DismissJobDeps,
  type DismissJobInput,
  type DismissJobResult,
  type RestoreJobDeps,
  type RestoreJobInput,
  type RestoreJobResult,
} from './app/dismiss-job.js';
export {
  partitionByDismissal,
  type DismissalPartition,
  type DismissedRow,
} from './app/dismissal-view.js';
export {
  DEFAULT_STALE_RUN_MS,
  startFetchRun,
  type StartFetchRunDeps,
  type StartFetchRunResult,
} from './app/fetch-run.js';
export { summarizeRun } from './app/summarize-run.js';
export {
  recordApplication,
  type RecordApplicationDeps,
  type RecordApplicationInput,
  type RecordApplicationResult,
} from './app/record-application.js';
export {
  updateApplicationOutcome,
  type UpdateApplicationOutcomeDeps,
  type UpdateApplicationOutcomeInput,
  type UpdateApplicationOutcomeResult,
} from './app/update-application-outcome.js';

/* Adapters ------------------------------------------------------------ */
export { createAdzunaJobSource } from './adapters/adzuna/adzuna-job-source.js';
export { createAshbyJobSource } from './adapters/boards/ashby-board.js';
export { createGreenhouseJobSource } from './adapters/boards/greenhouse-board.js';
export { createLeverJobSource } from './adapters/boards/lever-board.js';
export {
  BOARD_USER_AGENT,
  DEFAULT_BOARD_CONCURRENCY,
  DEFAULT_BOARD_TIMEOUT_MS,
  type BoardFetch,
} from './adapters/boards/board-http.js';
export {
  matchesBoardLocation,
  withExtraCityTerms,
  type BoardLocationFilter,
} from './adapters/boards/board-location.js';
export { htmlToPlainText } from './adapters/boards/html-text.js';
export type { BoardSourceFactoryOptions } from './adapters/boards/board-job-source.js';
export { createFixtureJobSource } from './adapters/fixture/fixture-job-source.js';
export {
  NEWSLETTER_PARSERS,
  NEWSLETTER_SOURCE_ID,
  createNewsletterJobSource,
  type LinkProvenance,
  type NewsletterJobSource,
  type NewsletterJobSourceOptions,
} from './adapters/newsletter/newsletter-job-source.js';
export {
  JUNIORJOBS_DIGEST_FORMAT,
  juniorJobsDigestParser,
} from './adapters/newsletter/juniorjobs-digest.js';
export {
  selectNewsletterParser,
  type NewsletterParseContext,
  type NewsletterParser,
  type NewsletterPosting,
} from './adapters/newsletter/newsletter-parser.js';
export {
  DEFAULT_LINK_CONCURRENCY,
  DEFAULT_LINK_TIMEOUT_MS,
  createPassthroughLinkResolver,
  createRedirectLinkResolver,
  type CachedResolution,
  type LinkFetch,
  type LinkResolution,
  type LinkResolutionCache,
  type LinkResolver,
} from './adapters/newsletter/link-resolver.js';
export { createJsonLinkCache } from './adapters/newsletter/json-link-cache.js';
export {
  DEFAULT_LIVENESS_CONCURRENCY,
  DEFAULT_LIVENESS_TIMEOUT_MS,
  DEFAULT_LIVENESS_TTL_MS,
  DEFAULT_LIVENESS_UNVERIFIED_TTL_MS,
  createHttpLinkChecker,
  type CachedLiveness,
  type LinkCheckFetch,
  type LivenessCache,
} from './adapters/liveness/http-link-checker.js';
export { createJsonLivenessCache } from './adapters/liveness/json-liveness-cache.js';
export { consoleLogger } from './adapters/logging/console-logger.js';
export { createJsonFileQueueReader } from './adapters/output/json-file-queue-reader.js';
export { createJsonFileQueueWriter } from './adapters/output/json-file-queue-writer.js';
export { createJsonApplicationRepository } from './adapters/persistence/json-application-repository.js';
export { createJsonDismissalRepository } from './adapters/persistence/json-dismissal-repository.js';
export { createJsonRunStateStore } from './adapters/persistence/json-run-state-store.js';
export {
  createQueuePipelineRunner,
  type QueuePipelineRunnerOptions,
} from './adapters/pipeline/queue-pipeline-runner.js';

/* Config -------------------------------------------------------------- */
export {
  CANDIDATE_PROFILE,
  DEFAULT_CANDIDATE_PROFILE_PATH,
  loadCandidateProfile,
  type CandidateProfile,
} from './config/candidate-profile.js';
export { DEFAULT_JUNIOR_FILTER_CONFIG } from './config/junior-filter-config.js';
export { DEFAULT_LIVENESS_CACHE_PATH } from './config/liveness.js';
export {
  DEFAULT_NEWSLETTER_DIR,
  DEFAULT_NEWSLETTER_LINK_CACHE,
  DEFAULT_NEWSLETTER_LINK_CONCURRENCY,
} from './config/newsletter.js';
export {
  DEFAULT_APPLICATION_LOG_PATH,
  DEFAULT_DISMISSAL_LOG_PATH,
  DEFAULT_FIXTURE_PATH,
  DEFAULT_QUEUE_PATH,
  DEFAULT_RUN_STATE_PATH,
  WORKSPACE_ROOT,
} from './config/paths.js';
export { DEFAULT_SCORING_CONFIG } from './config/scoring-config.js';
export { ADZUNA_IT_CATEGORY, DEFAULT_SEARCH_PLAN } from './config/search-plan.js';
export {
  BOARD_PROVIDER_IDS,
  COMPANY_BOARDS,
  DEFAULT_BOARD_LOCATION_FILTER,
  companiesFor,
  type BoardProviderId,
  type CompanyBoard,
} from './config/company-boards.js';

/* CLI helpers --------------------------------------------------------- */
export {
  BOARD_SOURCE_IDS,
  REAL_SOURCE_IDS,
  SAMPLE_SOURCE_IDS,
  SELECTABLE_SOURCE_IDS,
  isSampleSourceId,
  parseSourceSelection,
  type SelectableSourceId,
} from './cli/source-selection.js';
export {
  renderExcludedTable,
  renderLinkAudit,
  renderLivenessReport,
  renderRankedTable,
  renderRunSummary,
  renderSampleDataNotice,
  renderScoreExplanations,
} from './cli/render-table.js';
export { USAGE, parseCliOptions, type CliOptions } from './cli/options.js';
