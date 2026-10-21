import { describe, expect, it } from 'vitest';
import { APPLICATION_OUTCOMES, type ApplicationOutcome } from '@job-queue/core';
import { estadoCellStyle, replyCellStyle } from '@/components/tracking-status';
import { ES } from '@/copy/es';

/**
 * UI-2: the tracking cells must read like the user's Excel conditional
 * formatting, but never by colour alone — the Spanish status word stays.
 *
 * The colours are the spreadsheet's own explicit hex values, written as full
 * literal Tailwind arbitrary classes so the scanner sees them (they bypass the
 * dark-theme mirror on purpose, exactly like the spec says).
 */

describe('Estado cell style (the Excel conditional formatting)', () => {
  it.each([
    ['rejected', 'bg-[#FEE2E2] text-[#991B1B]'],
    ['applied', 'bg-[#DBEAFE] text-[#1D4ED8] font-bold'],
    ['screening', 'bg-[#DBEAFE] text-[#1D4ED8] font-bold'],
    ['interview', 'bg-[#DBEAFE] text-[#1D4ED8] font-bold'],
    ['offer', 'bg-[#DCFCE7] text-[#166534] font-bold'],
    ['no_reply', 'bg-[#E2E8F0] text-[#334155]'],
  ] as readonly (readonly [ApplicationOutcome, string])[])(
    'maps %s to its spreadsheet cell style',
    (outcome, className) => {
      const style = estadoCellStyle(outcome);

      expect(style.className).toBe(className);
      expect(style.label).toBe(ES.status[outcome]);
      expect(style.label).not.toContain('_');
    },
  );

  it('keeps the Spanish status word, so colour is never the only signal', () => {
    for (const outcome of APPLICATION_OUTCOMES) {
      expect(estadoCellStyle(outcome).label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('¿Contestó? cell style', () => {
  it.each(['rejected', 'screening', 'interview', 'offer'] as const)('answers Sí for %s', (outcome) => {
    const style = replyCellStyle(outcome);

    expect(style.label).toBe('Sí');
    expect(style.className).toBe('bg-[#DCFCE7] text-[#166534] font-bold');
  });

  it.each(['applied', 'no_reply'] as const)('answers No for %s', (outcome) => {
    const style = replyCellStyle(outcome);

    expect(style.label).toBe('No');
    expect(style.className).toBe('bg-[#FEE2E2] text-[#991B1B]');
  });

  it('covers every outcome exactly once between Sí and No', () => {
    const yes = ['rejected', 'screening', 'interview', 'offer'] as const;
    const no = ['applied', 'no_reply'] as const;
    expect([...yes, ...no].sort()).toEqual([...APPLICATION_OUTCOMES].sort());
  });
});
