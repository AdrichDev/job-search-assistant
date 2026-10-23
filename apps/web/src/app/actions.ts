'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { consoleLogger, type FetchRunState } from '@job-queue/core';
import {
  applicationHistoryRepository,
  cvModelRepository,
  applicationRepository,
  buildFallbackQueue,
  cvModelDeps,
  dismissalRepository,
  queueReader,
  runStateStore,
} from '@/server/container';
import { ACTION_MESSAGES } from '@/copy/action-messages';
import { EDIT_FORM_FIELDS, type EditFormValues } from '@/server/edit-form';
import {
  registerCvModelFromForm,
  removeCvModelFromForm,
  updateCvModelFromForm,
} from '@/server/cv-models';
import { pipelineRunner } from '@/server/pipeline';
import { mailCheckDeps } from '@/server/refresh';
import {
  applyToJob,
  dismissOffer,
  editApplication,
  readFetchState,
  restoreOffer,
  revertChange,
  setOutcome,
  startFetch,
  startRefresh,
  type ActionOutcome,
  type FetchDeps,
  type RefreshResult,
  type WriteDeps,
} from '@/server/use-cases';
import { checkMail } from '@/server/mail-use-cases';

/**
 * Server actions: the only write surface exposed to the browser.
 *
 * Thin on purpose. All decisions live in `@/server/use-cases` and, below that,
 * in `@job-queue/core` - neither of which imports Next.js, so both are directly
 * testable without a running server.
 */

function deps(): WriteDeps {
  const now = new Date();
  return {
    applicationRepository: applicationRepository(),
    historyRepository: applicationHistoryRepository(),
    cvModelRepository: cvModelRepository(),
    dismissalRepository: dismissalRepository(),
    // Falls back to the offline catalogue so an Apply click still resolves when
    // no CLI run has been persisted yet - the same queue the page is showing.
    loadQueue: async () => (await queueReader().read()) ?? (await buildFallbackQueue(now)),
    now: () => now,
  };
}

function fetchDeps(): FetchDeps {
  return {
    runStateStore: runStateStore(),
    pipelineRunner: pipelineRunner(),
    now: () => new Date(),
    newRunId: () => randomUUID(),
    logger: consoleLogger,
  };
}

export async function applyToJobAction(jobId: string): Promise<ActionOutcome> {
  const result = await applyToJob(jobId, deps());
  if (result.ok) {
    revalidatePath('/');
  }
  return result;
}

export async function setOutcomeAction(formData: FormData): Promise<void> {
  await setOutcome(formData.get('jobId'), formData.get('outcome'), formData.get('notes'), deps());
  revalidatePath('/');
}

/** Edits any field of an application by hand. The form is untrusted: see `editApplication`. */
export async function editApplicationAction(formData: FormData): Promise<ActionOutcome> {
  const result = await editApplication(formData, deps());
  if (result.ok) {
    revalidatePath('/seguimiento');
    revalidatePath('/');
  }
  return result;
}

/** State of the edit form between submissions: the message and what the person typed. */
export interface EditFormState {
  readonly message: string | null;
  readonly values: Partial<EditFormValues> | null;
  /** Bumped on every refusal so the form remounts with the typed values. */
  readonly attempt: number;
}

/**
 * `useActionState` adapter of the edit form. A refusal returns the typed values
 * so nothing the person wrote is lost; a success leaves for the tracking view,
 * which confirms it.
 */
export async function submitEditApplicationForm(
  previous: EditFormState,
  formData: FormData,
): Promise<EditFormState> {
  const result = await editApplicationAction(formData);
  if (result.ok) {
    const outcome =
      result.message === ACTION_MESSAGES.applicationEdited
        ? 'guardada'
        : result.message === ACTION_MESSAGES.applicationEditedNotLogged
          ? 'sin-registro'
          : 'sin-cambios';
    redirect(`/seguimiento?edicion=${outcome}`);
  }

  const values: Record<string, string> = {};
  for (const key of ['jobId', ...EDIT_FORM_FIELDS]) {
    const value = formData.get(key);
    if (typeof value === 'string') {
      values[key] = value;
    }
  }
  return { message: result.message, values, attempt: previous.attempt + 1 };
}

/**
 * Undoes one logged change, then returns to the edit page with the result in the
 * URL (the page words it in Spanish). A plain form post: it works with the
 * keyboard alone and without client JavaScript.
 */
export async function revertChangeAction(formData: FormData): Promise<void> {
  const result = await revertChange(formData, deps());
  if (result.ok) {
    revalidatePath('/seguimiento');
    revalidatePath('/');
  }
  if (result.jobId === null) {
    redirect(`/seguimiento?deshacer=${result.code}`);
  }
  const edit = `/seguimiento/${encodeURIComponent(result.jobId)}/editar`;
  revalidatePath(edit);
  redirect(`${edit}?deshacer=${result.code}#historial`);
}

export async function dismissOfferAction(
  jobId: string,
  reason?: string,
): Promise<ActionOutcome> {
  const result = await dismissOffer(jobId, deps(), reason);
  if (result.ok) {
    revalidatePath('/');
  }
  return result;
}

export async function restoreOfferAction(jobId: string): Promise<ActionOutcome> {
  const result = await restoreOffer(jobId, deps());
  if (result.ok) {
    revalidatePath('/');
  }
  return result;
}

/**
 * Background runs whose promises we deliberately do not await.
 *
 * Held in a module-level set for one reason: an unreferenced promise is a
 * candidate for garbage collection in some runtimes, and a collected run is a
 * lock that is never released. Cheap insurance for a set that holds at most one
 * entry - single-flight guarantees that.
 */
const inFlight = new Set<Promise<void>>();

/**
 * Starts an ingestion run and RETURNS IMMEDIATELY.
 *
 * The run is ~137 HTTP requests on a cold cache. Awaiting it here would blow
 * every timeout between the browser and this process and would tie the run's
 * survival to the tab that started it, so the completion promise is deliberately
 * dropped and the browser follows progress by polling `fetchStateAction`.
 *
 * Single-flight is NOT enforced by disabling the button. It is enforced in
 * `startFetchRun` by an exclusive-create lock, because a second tab has its own
 * button and a reloaded page has a fresh one.
 */
export async function startFetchAction(): Promise<ActionOutcome> {
  const { completion, ...outcome } = await startFetch(fetchDeps());

  inFlight.add(completion);
  /*
   * NO `revalidatePath` here, and that is a fix rather than an omission.
   *
   * This callback fires minutes later, long after the request that scheduled it
   * has been answered. Next refuses a revalidation raised outside a request or
   * action scope - it lands during whatever render happens to be in flight and
   * throws `Route / used "revalidatePath /" during render`, as an UNHANDLED
   * REJECTION in the server process. The E2E suite caught exactly that.
   *
   * The refresh belongs on the client instead, and is already there: the fetch
   * panel is polling, sees the run leave `running`, and calls `router.refresh()`
   * from a real client context. Same outcome, inside the lifecycle Next
   * actually supports.
   */
  void completion.finally(() => inFlight.delete(completion));

  return outcome;
}

/** What the run is doing right now. Polled by the fetch button while it runs. */
export async function fetchStateAction(): Promise<FetchRunState> {
  return readFetchState(fetchDeps());
}

/**
 * The ONE "Actualizar" control (S12): a mail review FIRST, then the offer
 * fetch, and what each half found as the answer.
 *
 * The mail review is awaited here - it is seconds, not minutes - while the
 * fetch is backgrounded exactly like `startFetchAction`: the completion
 * promise is dropped (with the same anti-GC insurance) and the browser follows
 * the run by polling `fetchStateAction`.
 *
 * Single-flight is NOT enforced here. The mail review refuses a concurrent run
 * itself (`already_running`), and the fetch refuses a second run through the
 * exclusive-create lock in `startFetchRun`, which is what keeps a second tab
 * from starting a duplicate.
 */
export async function startRefreshAction(): Promise<RefreshResult> {
  const mailDeps = mailCheckDeps();
  const { completion, ...outcome } = await startRefresh({
    runMailReview: () => checkMail(mailDeps, { force: true }),
    countPendingProposals: async () => (await mailDeps.proposals.listPending()).length,
    startRun: () => startFetch(fetchDeps()),
  });

  // Same insurance as `startFetchAction`: a collected completion would be a
  // lock that is never released. The set holds at most one entry.
  inFlight.add(completion);
  void completion.finally(() => inFlight.delete(completion));

  // `completion` is a promise and cannot cross the action boundary; the browser
  // polls the state file instead.
  return outcome;
}

/* CV model library -------------------------------------------------------- */

/*
 * Plain form posts that answer with a redirect and a fixed notice code in the
 * URL (post/redirect/get): they work with the keyboard alone and without client
 * JavaScript, and a reload never re-submits. The page words the code in Spanish
 * from a closed set, so nothing typed or thrown is ever echoed back.
 */

/** Registers a library PDF as a model. The form is untrusted: see `registerCvModelFromForm`. */
export async function registerCvModelAction(formData: FormData): Promise<void> {
  const result = await registerCvModelFromForm(formData, cvModelDeps());
  revalidatePath('/modelos');
  redirect(`/modelos?aviso=${result.code}${result.ok ? '' : '#registrar'}`);
}

/** Edits name, kind, language, tags and note. The path cannot be edited. */
export async function updateCvModelAction(formData: FormData): Promise<void> {
  const result = await updateCvModelFromForm(formData, cvModelDeps());
  revalidatePath('/modelos');
  if (result.ok || result.code === 'model_not_found') {
    redirect(`/modelos?aviso=${result.code}`);
  }
  const id = formData.get('id');
  redirect(
    typeof id === 'string' && id.length > 0 && id.length <= 200
      ? `/modelos/${encodeURIComponent(id)}/editar?aviso=${result.code}`
      : `/modelos?aviso=${result.code}`,
  );
}

/** Removes the registry entry only; the PDF in the user's folder is never touched. */
export async function removeCvModelAction(formData: FormData): Promise<void> {
  const result = await removeCvModelFromForm(formData, cvModelDeps());
  revalidatePath('/modelos');
  redirect(`/modelos?aviso=${result.code}`);
}
