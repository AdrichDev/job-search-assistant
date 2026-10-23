import type { ReactNode } from 'react';
import type { JobRequirements, QueueApplicationStatus } from '@job-queue/core/domain';
import { ES } from '@/copy/es';

/**
 * Small, flat labels. No icons, no colour-only meaning: every chip states its
 * fact in words, so it survives a screenshot, a colour-blind reader and a
 * grayscale print.
 *
 * Tones are deliberately low-saturation. These chips sit six to a card; at full
 * saturation they would compete with the Apply button, which is the only thing
 * on the card allowed to shout.
 */

type Tone = 'neutral' | 'accent' | 'warn' | 'good' | 'muted';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  accent: 'bg-sky-50 text-sky-900 ring-sky-200',
  warn: 'bg-amber-50 text-amber-900 ring-amber-300',
  good: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  muted: 'bg-white text-slate-600 ring-slate-200',
};

export function Chip({
  tone = 'neutral',
  compact = false,
  children,
}: {
  tone?: Tone;
  /** Smaller, for the offer card where six chips share one row (point 8). */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md ring-1 ring-inset ${TONES[tone]} ${
        compact ? 'px-1.5 py-0 text-[11px] font-medium' : 'px-2 py-0.5 text-xs font-medium'
      }`}
    >
      {children}
    </span>
  );
}

export function statusLabel(status: QueueApplicationStatus): string {
  return ES.status[status];
}

/**
 * Where the application stands.
 *
 * Every state carries its own word, so the meaning never depends on the tone.
 */
export function StatusChip({ status }: { status: QueueApplicationStatus }) {
  if (status === 'not_applied') {
    return <Chip tone="muted">{ES.status.not_applied}</Chip>;
  }

  const tone: Tone =
    status === 'offer' || status === 'interview' || status === 'screening'
      ? 'good'
      : status === 'rejected' || status === 'no_reply'
        ? 'warn'
        : 'accent';

  return <Chip tone={tone}>{ES.status[status]}</Chip>;
}

/**
 * The extracted signals, as scannable chips.
 *
 * This is the whole point of `extractRequirements`: the candidate should be
 * able to reject a posting in one second without opening it. The two chips that
 * decide that - years of experience and seniority signal - are printed first,
 * before the stack, because they are the ones that disqualify.
 */
export function RequirementChips({ requirements }: { requirements: JobRequirements }) {
  const juniorSignals = requirements.senioritySignals.filter((signal) => signal.level === 'junior');
  const seniorSignals = requirements.senioritySignals.filter((signal) => signal.level === 'senior');
  const firstJunior = juniorSignals[0];
  const firstSenior = seniorSignals[0];

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={ES.card.requirementsLabel}>
      {requirements.yearsRequired !== null && (
        <li>
          <Chip tone={requirements.yearsRequired >= 3 ? 'warn' : 'good'}>
            {ES.card.yearsRequired(requirements.yearsRequired)}
          </Chip>
        </li>
      )}

      {firstJunior !== undefined && (
        <li>
          <Chip tone="good">
            {firstJunior.where === 'title'
              ? ES.card.juniorSignalTitle
              : ES.card.juniorSignalDescription}
          </Chip>
        </li>
      )}

      {firstSenior !== undefined && (
        <li>
          <Chip tone="warn">
            {firstSenior.where === 'title'
              ? ES.card.seniorSignalTitle
              : ES.card.seniorSignalDescription}
          </Chip>
        </li>
      )}

      <li>
        <Chip tone="neutral">{ES.workMode[requirements.workMode]}</Chip>
      </li>

      <li>
        <Chip tone={requirements.englishRequired === 'advanced' ? 'warn' : 'neutral'}>
          {ES.english[requirements.englishRequired]}
        </Chip>
      </li>

      {requirements.matchedStack.slice(0, 8).map((technology) => (
        <li key={technology}>
          <Chip tone="accent">{technology}</Chip>
        </li>
      ))}

      {requirements.matchedStack.length > 8 && (
        <li>
          <Chip tone="muted">{ES.card.moreStack(requirements.matchedStack.length - 8)}</Chip>
        </li>
      )}
    </ul>
  );
}
