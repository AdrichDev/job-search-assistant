import {
  describeLinkProblems,
  inspectPostingLink,
  isTitleDerived,
  type LinkProblem,
} from '@job-queue/core/domain';

/**
 * The DOM-level adapter for the provenance rules.
 *
 * ## Why this file no longer contains the rules
 *
 * It used to. It held the whole rule set - placeholder hosts, placeholder
 * hrefs, the `isTitleDerived` check - written after thirteen "Aplicar" buttons
 * shipped pointing at `https://www.adzuna.es/details/<job title>`, all
 * returning HTTP 403.
 *
 * The rules were correct. Their ADDRESS was the defect. Living in the browser
 * suite, they could only be applied to queues this suite seeded itself, so no
 * matter how good they got they could never say anything about what the
 * pipeline produced. That is exactly what happened: months later
 * `npm start -- --source=all` put two `example-board.test` postings at
 * positions #1 and #3 of the user's real queue, with dead apply buttons, and
 * `link-integrity.spec.ts` was green the entire time.
 *
 * So the rules moved into `packages/core/src/domain/link-provenance.ts`, where
 * production code can run them, and there is now exactly one definition shared
 * by three callers:
 *
 *   - the CLI, auditing its own queue on every real run;
 *   - `packages/core/tests/app/pipeline-link-provenance.test.ts`, over a queue
 *     the pipeline actually built;
 *   - this suite, over the rendered `href` attributes.
 *
 * What stays here is the only part that is genuinely about the browser: turning
 * a DOM anchor into the shape the rules understand, and supplying the app's own
 * origin so the self-referential rule can fire - a CLI queue has no origin to
 * point back at, which is why that parameter is optional in the core.
 *
 * Still no request is made to any of these URLs. Fetching them would be exactly
 * the third-party-board traffic this project refuses to generate, and it would
 * make the suite depend on a stranger's server staying at HTTP 200. Provenance
 * is checked from the attribute, which is where the defect actually lived.
 */

export type { LinkProblem };
export { describeLinkProblems, isTitleDerived };

export interface LinkUnderTest {
  /** The `href` attribute exactly as it appears in the DOM. */
  readonly href: string | null;
  /** The job title rendered on the same card. */
  readonly title: string;
  /** `target` attribute, asserted separately by the apply-journey spec. */
  readonly target: string | null;
  /** `rel` attribute. */
  readonly rel: string | null;
}

/** Every rule, applied to one rendered link. */
export function inspectLink(link: LinkUnderTest, appOrigin: string): readonly LinkProblem[] {
  return inspectPostingLink({ url: link.href, title: link.title }, { appOrigin });
}
