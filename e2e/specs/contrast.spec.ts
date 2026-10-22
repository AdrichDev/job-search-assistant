import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { measureContrast, type ContrastSample } from '../support/contrast.js';
import { seedApplications } from '../support/workspace.js';

/**
 * The contrast safety net (UI-6).
 *
 * The theme mirrors Tailwind's light palette into a dark one, which means a
 * class name no longer tells you what colour is painted. Nothing in this suite
 * asserted colours, so a remap could have made text unreadable with every test
 * still green. This measures the composited colours on the three real pages and
 * holds them to WCAG AA: 4.5:1 for normal text, 3:1 for large text.
 */

const SELECTORS = [
  'main h1',
  'main h2',
  'main h3',
  'main p',
  'main a',
  'main button',
  'main summary',
  'main dt',
  'main dd',
  'main li',
  'main th',
  'main td',
] as const;

function offenders(samples: readonly ContrastSample[]): string[] {
  return samples
    .filter((sample) => sample.ratio < sample.required)
    .map(
      (sample) =>
        `${sample.ratio}:1 (needs ${sample.required}) on ${sample.background} — ` +
        `${sample.label} "${sample.text}"`,
    );
}

async function measure(page: Parameters<typeof measureContrast>[0]): Promise<readonly ContrastSample[]> {
  const samples = await measureContrast(page, SELECTORS);
  // A silent zero would make this spec useless, so the net proves it saw text.
  expect(samples.length).toBeGreaterThan(10);
  return samples;
}

test('the offer list keeps every text at AA', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await page.goto('/');

  const found = offenders(await measure(page));
  expect(found, `contrast below AA:\n${found.join('\n')}`).toEqual([]);
});

test('the tracking page keeps every text at AA', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  // The table is the page: without rows there is nothing to measure but chrome.
  await seedApplications([
    {
      jobId: 'contrast-1',
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      listing: { company: 'Acme Sistemas', title: 'Desarrollador Backend Júnior' },
    },
    {
      jobId: 'contrast-2',
      appliedAt: '2026-03-02T00:00:00.000Z',
      sourceIds: ['indeed'],
      outcome: 'rejected',
      outcomeUpdatedAt: '2026-03-03T00:00:00.000Z',
      listing: { company: 'Beta Datos', title: 'Analista Datos Junior' },
    },
  ]);
  await page.goto('/seguimiento');

  const found = offenders(await measure(page));
  expect(found, `contrast below AA:\n${found.join('\n')}`).toEqual([]);
});

test('the models page keeps every text at AA', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await page.goto('/modelos');

  const found = offenders(await measure(page));
  expect(found, `contrast below AA:\n${found.join('\n')}`).toEqual([]);
});
