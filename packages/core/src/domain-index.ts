/**
 * Client-safe surface: pure domain only.
 *
 * The root barrel (`@job-queue/core`) exports adapters that import `node:fs`
 * and `node:path`. Importing it from a React client component drags those into
 * the browser bundle and the build fails - correctly, because a browser has no
 * business holding the filesystem layer.
 *
 * This entry point exports ONLY pure domain code plus type-only port contracts,
 * so `'use client'` components can share the same vocabulary as the server
 * without duplicating enums or re-declaring shapes.
 *
 * Rule: nothing exported from here may import a node builtin or an adapter.
 * `tests/architecture/purity.test.ts` enforces it.
 */

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
  DISMISSAL_REASONS,
  createDismissal,
  indexDismissalsByJobId,
  isDismissalReason,
  type Dismissal,
  type DismissalDraft,
  type DismissalReason,
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

/*
 * Provenance. Pure string rules, no I/O, so both the server and a `'use client'`
 * component can ask the same two questions: "is this posting invented?" and
 * "is this address one a source actually reported?".
 */
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
/*
 * The removal rule. Pure, so the card component can ask the same question the
 * pipeline asked - "did this posting prove it is gone?" - instead of
 * re-implementing a status comparison in JSX and drifting from it.
 */
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
export { dedupeJobs } from './domain/dedupe.js';
export { canonicalCompany, canonicalTitle, crossSourceKey } from './domain/identity.js';
export { SCORE_DIMENSIONS } from './domain/scoring/types.js';
export type {
  ScoreBreakdownItem,
  ScoreDimension,
  ScoredJob,
  ScoringConfig,
  SoftwareRelevanceSummary,
} from './domain/scoring/types.js';

/* Port contracts are types only: they are erased at compile time and carry no
 * runtime code, so they are safe to share with the browser. */
export type {
  ExcludedEntry,
  ExclusionFilter,
  JobQueue,
  LivenessSummary,
  QueueApplicationStatus,
  QueueEntry,
  SourceReport,
} from './ports/queue-writer.js';

/*
 * The fetch run's state, shared with the browser.
 *
 * Type-only and runtime-free, like every port contract here. The client needs
 * these shapes because the fetch button renders the state a server action hands
 * back; without them it would re-declare the union and drift from it the first
 * time a field is added.
 */
export type { FetchRunState, FetchRunSummary } from './ports/run-state-store.js';

/** Mail check state shape (type-only) and the pure schedule / token-expiry rules. */
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
export { portalFromSender } from './domain/mail-portal.js';
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
export type {
  GmailFetchResult,
  GmailQuery,
  GmailReader,
  MailMessage,
  MailUnavailableReason,
} from './ports/gmail-reader.js';
export {
  MAIL_RETRY_COOLDOWN_MS,
  MAIL_RUN_HOUR,
  MAIL_TIME_ZONE,
  TOKEN_LIFETIME_DAYS,
  isMailCheckAllowed,
  isMailRunDue,
  latestScheduledRun,
  tokenExpiresAt,
  tokenStatus,
  type TokenStatus,
} from './domain/mail-schedule.js';

/**
 * One row of the "dismissed" review list.
 *
 * A view model rather than a persisted shape, which is why it lives in the app
 * layer - but it is pure data and the collapsed section in the browser renders
 * it directly.
 */
export type { DismissedRow } from './app/dismissal-view.js';
