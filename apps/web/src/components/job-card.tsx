import { hasSampleDataSource, type QueueEntry } from '@job-queue/core/domain';

import { ApplyLink } from '@/components/apply-link';
import { Chip, StatusChip } from '@/components/chips';
import { describeCvCategorySuggestion } from '@/components/cv-category-copy';
import { DismissButton } from '@/components/dismiss-button';
import { OfferDetail, type OfferDetailRow } from '@/components/offer-detail';
import { OutcomeForm } from '@/components/outcome-form';
import { ES, cvVariantLabel } from '@/copy/es';
import { formatPostedAge } from '@/lib/posted-age';
import { offerSnippet } from '@/lib/offer-snippet';
import { entrySourceLabels, sourceLabel } from '@/lib/source-labels';

/**
 * One vacancy, as a job-board results row.
 *
 * The user was explicit twice: the list is the SIMPLIFIED list ("quiero que la
 * lista sea la lista simplificada") and it shows exactly what a results row
 * shows, in this order: title, company, locality, contract type, when it was
 * published, a short description snippet, salary, requested years of
 * experience, and where the offer came from. Then the actions.
 *
 * Ver is not aplicar: the title is a plain link to the posting that records
 * nothing, and `Aplicar` stays the deliberate action that writes to the log.
 *
 * What deliberately does NOT live here anymore, and only inside the `Abrir`
 * dialog: the full description, the complete requirements list, the score
 * breakdown and the per-source links. The score is still computed and still
 * matters - it is one click away, where an inspectable secondary detail
 * belongs.
 *
 * The Apply button sits in its own column on desktop and drops to full width on
 * mobile, where thumb reach matters more than alignment.
 *
 * An applied card is tinted and gets a left accent rail rather than being
 * greyed out - "done" is progress worth seeing, not information to hide.
 */

function salaryLabel(entry: QueueEntry): string | null {
  if (entry.salaryMin === null && entry.salaryMax === null) {
    return null;
  }
  const format = (value: number) => `${Math.round(value / 1000)}k`;
  if (entry.salaryMin !== null && entry.salaryMax !== null) {
    return ES.card.salaryRange(format(entry.salaryMin), format(entry.salaryMax));
  }
  const single = entry.salaryMin ?? entry.salaryMax;
  return single === null ? null : ES.card.salaryFrom(format(single));
}

/** The card's snippet: the first line or two, never the whole description. */
function snippetOf(entry: QueueEntry): string | null {
  return entry.description === undefined || entry.description.length === 0
    ? null
    : offerSnippet(entry.description);
}

/** One label per source the vacancy actually came from, first url wins. */
function sourceLinksOf(entry: QueueEntry): { label: string; url: string }[] {
  const seen = new Set<string>();
  const links: { label: string; url: string }[] = [];
  for (const ref of entry.sources) {
    if (seen.has(ref.sourceId)) {
      continue;
    }
    seen.add(ref.sourceId);
    links.push({ label: sourceLabel(ref.sourceId), url: ref.url });
  }
  return links;
}

export function JobCard({ entry, now }: { entry: QueueEntry; now: number }) {
  const applied = entry.applicationStatus !== 'not_applied';
  const salary = salaryLabel(entry);
  const snippet = snippetOf(entry);
  const sourceLinks = sourceLinksOf(entry);
  /*
   * Is this offer invented?
   *
   * Asked per card rather than once for the page, because the banner at the top
   * scrolls away and the decision is made down here, next to the Apply button.
   * Read from the posting's own `sources[]`, so it is true regardless of which
   * flags produced the queue or how old the queue file is.
   */
  const isSample = hasSampleDataSource(entry);
  /*
   * Could we confirm this posting is still there?
   *
   * Only `unverified` is marked. The other two states are silent on purpose:
   * `alive` needs no badge (a confirmation chip on 118 of 127 cards is noise
   * that teaches the eye to skip the row of chips entirely), and `gone` cannot
   * appear here at all, because a posting that proved it was gone was removed
   * from the queue before it ever reached a card.
   *
   * `null` - never checked, because `--no-check-links` was passed or the queue
   * predates the feature - is also silent. Marking it would put an "unverified"
   * badge on every card of an offline run, which says nothing and costs the
   * badge all of its meaning for the cases where it does.
   */
  const isUnverified = entry.liveness?.verdict === 'unverified';
  /*
   * Absent on a queue written before the suggestion existed: those cards show
   * nothing rather than pretend they were analysed. A General suggestion on a
   * newly analysed offer IS rendered, with its explanation.
   */
  const categoryView =
    entry.cvCategorySuggestion === undefined
      ? null
      : describeCvCategorySuggestion(entry.cvCategorySuggestion);

  /* The facts the dialog repeats in full, including the ones the card dropped. */
  const detailRows: readonly OfferDetailRow[] = [
    { label: ES.detail.rows.company, value: entry.company },
    { label: ES.detail.rows.location, value: entry.location },
    ...(salary === null ? [] : [{ label: ES.detail.rows.salary, value: salary }]),
    ...(entry.contractType === null
      ? []
      : [{ label: ES.detail.rows.contract, value: entry.contractType }]),
    { label: ES.detail.rows.posted, value: formatPostedAge(new Date(entry.postedAt), now) },
  ];
  return (
    <article
      className={`rounded-xl border bg-white shadow-sm transition hover:shadow-md motion-reduce:transition-none ${
        isSample
          ? // Amber rail, matching the page banner: same colour, same claim.
            'border-amber-300 border-l-4 border-l-amber-500 bg-amber-50/40'
          : applied
            ? 'border-emerald-200 border-l-4 border-l-emerald-600 bg-emerald-50/30'
            : 'border-slate-200 border-l-4 border-l-transparent'
      }`}
      aria-labelledby={`job-title-${entry.id}`}
    >
      <div className="p-3 sm:p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {/*
              The title is the first thing in the card, and it is the way to
              LOOK at the offer: a plain external link that records nothing.
              Applying stays on `Aplicar`, which is the control that writes.
            */}
            <h3
              id={`job-title-${entry.id}`}
              className="text-base font-semibold leading-snug text-slate-900 sm:text-lg"
            >
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="job-title-link"
                /*
                  The new-tab warning lives in the accessible name, NOT in an
                  sr-only span inside the heading: the heading's text stays
                  exactly the job title, which is what the link-provenance
                  rules read off the card.
                */
                aria-label={`${entry.title} ${ES.viewOffer.titleSuffix}`}
                className="hover:underline motion-reduce:hover:no-underline"
              >
                {entry.title}
              </a>
            </h3>

            <p className="mt-1 text-sm font-medium text-slate-700">
              {entry.company}
              <span className="font-normal text-slate-400"> · </span>
              <span className="font-normal text-slate-600">{entry.location}</span>
            </p>

            {/*
              First metadata line: the kind of work and how fresh the posting
              is, in the words a job board uses ("hace 3 horas", "ayer").
            */}
            <p className="mt-1 text-xs text-slate-500" data-testid="job-posted">
              {entry.contractType !== null && `${entry.contractType} · `}
              {formatPostedAge(new Date(entry.postedAt), now)}
            </p>

            {/*
              The short description: one or two lines, cut, ellipsis. The FULL
              text is one click away in the dialog and never rendered here.
            */}
            {snippet !== null && (
              <p data-testid="job-snippet" className="mt-1.5 max-w-prose text-sm text-slate-600">
                {snippet}
              </p>
            )}

            {/*
              Second metadata line: salary when it exists, requested experience
              when the posting states it, and where the offer came from - the
              sources we actually hold, never portals we do not fetch.
            */}
            <p className="mt-1 text-xs text-slate-500" data-testid="job-facts">
              {salary !== null && `${salary} · `}
              {entry.requirements.yearsRequired !== null &&
                `${ES.card.yearsRequired(entry.requirements.yearsRequired)} · `}
              {`${ES.source.cardLabel(sourceLinks.length)}: ${entrySourceLabels(entry).join(' · ')}`}
            </p>

            {/*
              A secondary, explicit way to look without applying, for anyone
              who does not guess that the title is clickable.
            */}
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="job-view-link"
              className="mt-2 inline-block text-xs font-medium text-indigo-700 underline"
            >
              {ES.viewOffer.action}
              <span className="sr-only"> {ES.viewOffer.screenReader(entry.title, entry.company)}</span>
            </a>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {/*
                First chip, before the CV variant and the status: if this offer
                is not real, nothing else on the card matters.
              */}
              {isSample && (
                <span title={ES.card.sampleBadgeTitle}>
                  <Chip tone="warn" compact>
                    {ES.card.sampleBadge}
                  </Chip>
                </span>
              )}
              {/*
                Deliberately `muted`, not `warn`, and deliberately AFTER the
                sample badge.

                These are overwhelmingly bot-protected careers sites answering
                403 to any automated check - ordinary, frequent, and not a
                problem with the vacancy. Giving them amber would put a warning
                on perfectly live offers and drown the badge above, which marks
                a posting that is genuinely invented. The offers that failed the
                check are not here to be warned about: they were removed.
              */}
              {isUnverified && (
                <span title={ES.card.unverifiedBadgeTitle}>
                  <Chip tone="muted" compact>
                    {ES.card.unverifiedBadge}
                  </Chip>
                </span>
              )}
              <Chip tone="neutral" compact>
                {cvVariantLabel(entry.cvVariant)}
              </Chip>
              <StatusChip status={entry.applicationStatus} />
            </div>

            {categoryView !== null && (
              <section
                data-testid="cv-category-suggestion"
                aria-labelledby={`cv-category-${entry.id}`}
                className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
              >
                {/*
                  Heading and category on ONE line: the category name used to
                  have its own paragraph right under a heading that says the
                  same thing, which is a line of height per card for nothing.
                  The heading keeps its h4 semantics and its id, because
                  aria-labelledby points at it.
                */}
                <h4 id={`cv-category-${entry.id}`} className="font-semibold text-slate-800">
                  {categoryView.heading}:{' '}
                  <span className="font-semibold text-slate-900">{categoryView.categoryName}</span>
                </h4>
                <p className="mt-0.5">{categoryView.explanation}</p>
                <p className="mt-0.5 text-slate-500">{categoryView.disclaimer}</p>
              </section>
            )}
          </div>

          {/*
            Actions, in strict order of weight.

            Apply is first, owns the accent colour and is the only filled
            control on the card. Dismiss sits UNDER it, smaller, unfilled and in
            slate - reachable and unambiguous, but never competing for the eye.
            Putting them side by side would make them read as two equal choices,
            which they are not: one is why this page exists and the other is
            housekeeping.
          */}
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
            <OfferDetail
              detailId={entry.id}
              title={entry.title}
              company={entry.company}
              rows={detailRows}
              {...(entry.description === undefined ? {} : { description: entry.description })}
              requirements={entry.requirements}
              breakdown={entry.breakdown}
              score={entry.score}
              sources={sourceLinks}
              jobId={entry.id}
              url={entry.url}
              applied={applied}
            />
            <ApplyLink jobId={entry.id} url={entry.url} applied={applied} title={entry.title} />
            <DismissButton jobId={entry.id} title={entry.title} applied={applied} />
          </div>
        </div>

        <OutcomeForm jobId={entry.id} status={entry.applicationStatus} notes={entry.notes} />
      </div>
    </article>
  );
}
