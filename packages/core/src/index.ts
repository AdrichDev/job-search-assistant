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
  ApplicationPatchError,
  MAX_MODEL_ID_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_TEXT_LENGTH,
  PATCH_REFUSAL_REASONS,
  applicationsEqual,
  applyApplicationPatch,
  createApplication,
  indexApplicationsByJobId,
  isAdvance,
  isApplicationOutcome,
  isResponse,
  withOutcome,
  type Application,
  type ApplicationDraft,
  type ApplicationOutcome,
  type ApplicationPatch,
  type ApplyPatchResult,
  type ListingPatch,
  type PatchRefusalReason,
} from './domain/application.js';

export {
  computeApplicationStats,
  type ApplicationStats,
  type ModelStats,
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

export {
  CV_CATEGORIES,
  suggestCvCategory,
  type CvCategory,
  type CvCategoryInput,
  type CvCategoryReason,
  type CvCategorySuggestion,
} from './domain/cv-category.js';

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
export {
  CHANGE_SOURCES,
  HISTORY_FIELDS,
  analyzeHistory,
  diffApplications,
  fieldValue,
  isHistoryField,
  patchRestoring,
  sameChangeValue,
  type ApplicationChange,
  type ChangeSource,
  type ChangeValue,
  type FieldChange,
  type HistoryAnalysis,
  type HistoryField,
} from './domain/application-history.js';
export type { ApplicationHistoryRepository } from './ports/application-history-repository.js';
export type {
  ApplicationRepository,
  RecordResult,
  UpdateApplicationInput,
  UpdateOutcomeInput,
  UpdateResult,
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
export { EMPTY_MAIL_RUN_STATE } from './ports/mail-run-state-store.js';
export type { MailRunState, MailRunStateStore } from './ports/mail-run-state-store.js';
export {
  MAIL_PROPOSAL_OUTCOMES,
  MAIL_PROPOSAL_STATUSES,
  MAX_PROPOSAL_SNIPPET_LENGTH,
  createMailProposal,
  isMailProposalOutcome,
  sanitizeSnippet,
  type MailProposal,
  type MailProposalDraft,
  type MailProposalOutcome,
  type MailProposalStatus,
} from './domain/mail-proposal.js';
export {
  classifyReply,
  type ReplyClassification,
  type ReplyInput,
  type ReplyOutcome,
} from './domain/mail-reply.js';
export type {
  AddMailProposalResult,
  MailProposalRepository,
} from './ports/mail-proposal-repository.js';
export {
  proposeFromMail,
  type ProposeFromMailInput,
  type ProposeFromMailResult,
} from './app/propose-from-mail.js';
export type {
  GmailFetchResult,
  GmailQuery,
  GmailReader,
  MailMessage,
  MailUnavailableReason,
} from './ports/gmail-reader.js';
export {
  DEFAULT_MAIL_STALE_RUN_MS,
  runMailCheck,
  type RunMailCheckDeps,
  type RunMailCheckOptions,
  type RunMailCheckResult,
} from './app/run-mail-check.js';
export {
  MAIL_RUN_HOUR,
  MAIL_TIME_ZONE,
  TOKEN_LIFETIME_DAYS,
  isMailRunDue,
  latestScheduledRun,
  tokenExpiresAt,
  tokenStatus,
  type TokenStatus,
} from './domain/mail-schedule.js';
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
  buildTrackedApplications,
  countByOutcome,
  type TrackableQueueJob,
  type TrackedApplication,
} from './app/tracked-applications.js';
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
  editApplication,
  type EditApplicationDeps,
  type EditApplicationInput,
  type EditApplicationResult,
} from './app/edit-application.js';
export {
  updateApplicationOutcome,
  type UpdateApplicationOutcomeDeps,
  type UpdateApplicationOutcomeInput,
  type UpdateApplicationOutcomeResult,
} from './app/update-application-outcome.js';

export {
  revertApplicationChange,
  type RevertApplicationChangeDeps,
  type RevertApplicationChangeInput,
  type RevertApplicationChangeResult,
} from './app/revert-application-change.js';
export {
  importApplicationHistory,
  type ImportApplicationHistoryDeps,
  type ImportApplicationHistoryResult,
  type SkippedRow,
} from './app/import-application-history.js';
export type { HistoryReader, HistoryRow } from './ports/history-reader.js';

/* Adapters ------------------------------------------------------------ */
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
export { createJsonApplicationHistoryRepository } from './adapters/persistence/json-application-history-repository.js';
export { createJsonDismissalRepository } from './adapters/persistence/json-dismissal-repository.js';
export { createJsonCvModelRepository } from './adapters/persistence/json-cv-model-repository.js';
export { createCvLibrary } from './adapters/library/cv-library.js';
export { createJsonRunStateStore } from './adapters/persistence/json-run-state-store.js';
export { createJsonMailRunStateStore } from './adapters/persistence/json-mail-run-state-store.js';
export { createJsonMailProposalRepository } from './adapters/persistence/json-mail-proposal-repository.js';
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
  DEFAULT_APPLICATION_LOG_PATH,
  DEFAULT_CV_LIBRARY_DIR,
  DEFAULT_CV_MODELS_PATH,
  DEFAULT_DISMISSAL_LOG_PATH,
  DEFAULT_HISTORY_LOG_PATH,
  DEFAULT_FIXTURE_PATH,
  DEFAULT_QUEUE_PATH,
  DEFAULT_MAIL_RUN_STATE_PATH,
  DEFAULT_MAIL_PROPOSALS_PATH,
  DEFAULT_RUN_STATE_PATH,
  WORKSPACE_ROOT,
} from './config/paths.js';
export { DEFAULT_SCORING_CONFIG } from './config/scoring-config.js';
export { DEFAULT_SEARCH_PLAN } from './config/search-plan.js';
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

/* CV model library ---------------------------------------------------- */
export {
  CV_MODEL_KINDS,
  CV_MODEL_LANGUAGES,
  CV_MODEL_LIMITS,
  checkRelativePath,
  isCvModelKind,
  isCvModelLanguage,
  normalizeTags,
  relativePathKey,
  validateCvModelDraft,
  validateCvModelPatch,
  type CvModel,
  type CvModelDraft,
  type CvModelKind,
  type CvModelLanguage,
  type CvModelPatch,
  type CvModelValidationReason,
} from './domain/cv-model.js';
export type {
  AddCvModelResult,
  CvModelRepository,
  UpdateCvModelResult,
} from './ports/cv-model-repository.js';
export {
  MAX_MODEL_FILE_BYTES,
  type CvLibrary,
  type ListCandidateOptions,
  type ListCandidatesResult,
  type ModelFileRefusalReason,
  type ReadModelFileResult,
  type ResolveModelFileResult,
} from './ports/cv-library.js';
export {
  listCvModels,
  listRegistrableCandidates,
  registerCvModel,
  removeCvModel,
  updateCvModel,
  type CvModelDeps,
  type CvModelRefusalReason,
  type ListCandidatesOutcome,
  type ListCvModelsResult,
  type ListedCvModel,
  type RegisterCvModelResult,
  type RemoveCvModelResult,
  type UpdateCvModelOutcome,
} from './app/cv-models.js';
