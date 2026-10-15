import { hasSampleDataSource, type QueueEntry } from '@job-queue/core/domain';

import { ApplyLink } from '@/components/apply-link';
import { Chip, RequirementChips, StatusChip } from '@/components/chips';
import { DismissButton } from '@/components/dismiss-button';
import { OutcomeForm } from '@/components/outcome-form';
import { ScoreBreakdown } from '@/components/score-breakdown';
import { ES, cvVariantLabel } from '@/copy/es';

/**
 * One vacancy.
 *
 * Reading order is the decision order, and it changed with the product: the
 * TITLE and the EMPLOYER come first, then how old the posting is, then what
 * would disqualify it (chips), then the action.
 *
 * What is deliberately no longer here:
 *
 *  - the `#3` position marker. Position is now just "how far down the page this
 *    sits", and printing it invited the reader to treat it as a verdict.
 *  - the 3xl score. The candidate said he would judge the offers himself, and a
 *    number set larger than the job title is the interface arguing with him.
 *    The score is still there, one click away inside the breakdown, which is
 *    where an inspectable secondary detail belongs.
 *
 * The Apply button sits in its own column on desktop and drops to full width on
 * mobile, where thumb reach matters more than alignment.
 *
 * An applied card is tinted and gets a left accent rail rather than being
 * greyed out - "done" is progress worth seeing, not information to hide.
 */

function ageLabel(postedAt: string, now: number): string {
  const days = Math.round((now - new Date(postedAt).getTime()) / 86_400_000);
  return days <= 0 ? ES.card.postedToday : ES.card.postedAgo(days);
}

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

export function JobCard({ entry, now }: { entry: QueueEntry; now: number }) {
  const applied = entry.applicationStatus !== 'not_applied';
  const salary = salaryLabel(entry);
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
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {/*
              The title is the first thing in the card now. The chips that used
              to sit above it moved below the employer line: they are context
              for a decision, not a headline.
            */}
            <h3
              id={`job-title-${entry.id}`}
              className="text-base font-semibold leading-snug text-slate-900 sm:text-lg"
            >
              {entry.title}
            </h3>

            <p className="mt-1 text-sm font-medium text-slate-700">
              {entry.company}
              <span className="font-normal text-slate-400"> · </span>
              <span className="font-normal text-slate-600">{entry.location}</span>
            </p>

            <p className="mt-1 text-xs text-slate-500">
              {ageLabel(entry.postedAt, now)}
              {salary !== null && ` · ${salary}`}
              {entry.contractType !== null && ` · ${entry.contractType}`}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {/*
                First chip, before the CV variant and the status: if this offer
                is not real, nothing else on the card matters.
              */}
              {isSample && (
                <span title={ES.card.sampleBadgeTitle}>
                  <Chip tone="warn">{ES.card.sampleBadge}</Chip>
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
                  <Chip tone="muted">{ES.card.unverifiedBadge}</Chip>
                </span>
              )}
              <Chip tone="neutral">{cvVariantLabel(entry.cvVariant)}</Chip>
              <StatusChip status={entry.applicationStatus} />
            </div>
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
            <ApplyLink jobId={entry.id} url={entry.url} applied={applied} title={entry.title} />
            <DismissButton jobId={entry.id} title={entry.title} applied={applied} />
          </div>
        </div>

        <div className="mt-4">
          <RequirementChips requirements={entry.requirements} />
        </div>

        <ScoreBreakdown breakdown={entry.breakdown} total={entry.score} />

        <OutcomeForm jobId={entry.id} status={entry.applicationStatus} notes={entry.notes} />
      </div>
    </article>
  );
}
