import { readFile } from 'node:fs/promises';
import { expect, test } from '../support/test.js';
import { GENERATED_AT, HEALTHY_QUEUE } from '../fixtures/queue.js';
import { SCRATCH_APPLICATIONS_PATH, readApplications } from '../support/workspace.js';
import { applyLinkFor, cardFor } from '../support/test.js';
import type { QueueFile } from '../fixtures/queue.js';

/**
 * The list is the SIMPLIFIED list and `Abrir` is the full detail, the way the
 * user phrased both: "quiero que la lista sea la lista simplificada" and
 * "cuando se de a abrir salga toda la informacion de dicha oferta como ocurre
 * con las ofertas cuando las ves en infojobs, indeed etc etc..".
 *
 * The card shows exactly what a job-board results row shows: title, company,
 * locality, contract type, a RELATIVE publication age, a short description
 * snippet, salary, requested years of experience and the source labels - then
 * the actions. Ver is not aplicar: the title and "Ver oferta" open the posting
 * and record nothing; only `Aplicar` writes to the log.
 *
 * The fixture queue gets descriptions and one required-experience figure,
 * because the shipped `HEALTHY_QUEUE` predates the description field on
 * purpose (legacy files must still render).
 */

/*
 * The card snippet is cut at 160 characters, so the first sentence is long
 * enough that the ellipsis lands BEFORE the second one: what the card holds
 * and what the dialog adds are genuinely different amounts of text.
 */
const FIRST_SENTENCE =
  'Posición para desarrollar interfaces con React y TypeScript en un equipo de seis personas, ' +
  'manteniendo y mejorando el design system compartido, con revisión de código tranquila.';
const SECOND_SENTENCE = 'Esta segunda frase solo existe dentro del diálogo';

const FULL_DESCRIPTION = `${FIRST_SENTENCE} ${SECOND_SENTENCE}.`;

const DESCRIBED_QUEUE: QueueFile = {
  ...HEALTHY_QUEUE,
  jobs: HEALTHY_QUEUE.jobs.map((job, index) => {
    if (index === 0) {
      return {
        ...job,
        description: FULL_DESCRIPTION,
        requirements: { ...job.requirements, yearsRequired: 2 },
      };
    }
    if (index === 2) {
      // Three hours before the frozen clock, so the relative age has an hours case.
      return { ...job, description: FULL_DESCRIPTION, postedAt: '2026-03-10T06:00:00.000Z' };
    }
    return job;
  }),
};

const TITLE = HEALTHY_QUEUE.jobs[0]!.title;

async function rawApplicationsFile(): Promise<string> {
  return readFile(SCRATCH_APPLICATIONS_PATH, 'utf8');
}

test.describe('the simplified offer row', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(DESCRIBED_QUEUE);
  });

  test('the card shows the nine facts a job-board row shows', async ({ page }) => {
    await page.goto('/');

    const card = cardFor(page, TITLE);

    // 1. Title - as a real link to the posting that records nothing.
    const titleLink = card.getByTestId('job-title-link');
    await expect(titleLink).toHaveAttribute('href', HEALTHY_QUEUE.jobs[0]!.url);
    await expect(titleLink).toHaveAttribute('target', '_blank');
    await expect(titleLink).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(titleLink).toContainText(TITLE);

    // 2 and 3. Company and locality.
    await expect(card).toContainText('ACME Digital');
    await expect(card).toContainText('Madrid');

    // 4. Type of work.
    await expect(card.getByTestId('job-posted')).toContainText('permanent');

    // 5. Published: the fixture is exactly one day old at the frozen clock.
    await expect(card.getByTestId('job-posted')).toContainText('ayer');

    // 6. The short description: cut short, with the second sentence nowhere on the card.
    await expect(card.getByTestId('job-snippet')).toContainText(
      'Posición para desarrollar interfaces con React y TypeScript',
    );
    await expect(card.getByTestId('job-snippet')).not.toContainText(SECOND_SENTENCE);

    // 7. Salary.
    await expect(card.getByTestId('job-facts')).toContainText('24k–30k €');

    // 8. Requested experience, only when the posting states it.
    await expect(card.getByTestId('job-facts')).toContainText('2 años de experiencia');

    // 9. Where it came from: the labels we actually hold.
    await expect(card.getByTestId('job-facts')).toContainText('Fuente: Greenhouse');

    // 10. The actions.
    await expect(card.getByRole('button', { name: 'Abrir', exact: true })).toBeVisible();
    await expect(applyLinkFor(page, TITLE)).toBeVisible();
    await expect(card.getByRole('button', { name: /Descartar/ })).toBeVisible();
  });

  test('the relative publication age covers hours as well as days', async ({ page }) => {
    await page.goto('/');

    // Posted 3 hours before the frozen clock: hours, not days.
    await expect(cardFor(page, 'Becario Desarrollo Software').getByTestId('job-posted')).toContainText(
      'hace 3 horas',
    );
    // And the whole list states the same age nowhere in absolute form for this card.
    await expect(cardFor(page, 'Becario Desarrollo Software').getByTestId('job-posted')).not.toContainText(
      'mar 2026',
    );
  });

  test('the full description, the requirements, the breakdown and the links live only in the dialog', async ({
    page,
  }) => {
    await page.goto('/');

    const card = cardFor(page, TITLE);
    // Before opening: no full description, no score, no requirement-chip wall.
    await expect(card).not.toContainText(SECOND_SENTENCE);
    await expect(card.getByText('Ver puntuación')).toHaveCount(0);
    await expect(card.locator('[aria-label="Requisitos detectados"]')).toHaveCount(0);

    await card.getByRole('button', { name: 'Abrir', exact: true }).click();
    const modal = card.getByTestId('offer-detail-modal');
    await expect(modal).toBeVisible();

    // The FULL description, paragraphs preserved.
    await expect(modal).toContainText(FIRST_SENTENCE);
    await expect(modal).toContainText(`${SECOND_SENTENCE}.`);

    // Every fact we hold, in the dark facts grid.
    await expect(modal).toContainText('Ubicación');
    await expect(modal).toContainText('Madrid');
    await expect(modal).toContainText('24k–30k €');
    await expect(modal).toContainText('permanent');
    await expect(modal).toContainText('ayer');

    // The per-source links.
    await expect(modal.getByRole('link', { name: /Greenhouse/ })).toHaveAttribute(
      'href',
      HEALTHY_QUEUE.jobs[0]!.url,
    );

    // The score breakdown with its total.
    await expect(modal).toContainText('Puntuación estimada');
    await expect(modal).toContainText('61.4 pts');

    // The requirements that left the card: experience, mode, english, stack.
    await expect(modal).toContainText('2 años de experiencia');
    await expect(modal).toContainText('react');
    await expect(modal).toContainText('typescript');

    // The dialog keeps its surface rules: explicit dark card on a blurred backdrop.
    const style = await modal.evaluate((element) => {
      const backdrop = getComputedStyle(element, '::backdrop') as CSSStyleDeclaration & {
        webkitBackdropFilter?: string;
      };
      return {
        surface: getComputedStyle(element).backgroundColor,
        backdrop: backdrop.backgroundColor,
        blur: backdrop.backdropFilter || backdrop.webkitBackdropFilter,
      };
    });
    expect(style.surface).toBe('rgb(15, 23, 42)');
    expect(style.backdrop).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.blur).toContain('blur');
  });

  test('the dialog separates Ver la oferta from Aplicar', async ({ page }) => {
    await page.goto('/');

    const card = cardFor(page, TITLE);
    await card.getByRole('button', { name: 'Abrir', exact: true }).click();
    const modal = card.getByTestId('offer-detail-modal');
    await expect(modal).toBeVisible();

    // The link out: a real link, not styled as the apply button.
    const viewLink = modal.getByRole('link', { name: /Ver la oferta/ }).filter({ hasText: 'Ver la oferta' });
    await expect(viewLink).toHaveAttribute('target', '_blank');
    await expect(viewLink).toHaveAttribute('href', HEALTHY_QUEUE.jobs[0]!.url);

    // Aplicar, as the recording control, right next to it.
    await expect(modal.getByRole('link', { name: /Aplicar/ })).toBeVisible();

    // Escape closes, like Cerrar does.
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});

/** Small local helper so the actions assertion reads like the rest of the file. */
test.describe('ver is not aplicar', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(DESCRIBED_QUEUE);
  });

  test('opening the posting with Ver oferta records NOTHING, Aplicar does', async ({ page }) => {
    await page.goto('/');
    const before = await rawApplicationsFile();
    expect(before).toBeDefined();

    // The explicit secondary control: opens in a new tab, writes nothing.
    await cardFor(page, TITLE).getByTestId('job-view-link').click();
    await expect
      .poll(async () => await rawApplicationsFile(), { timeout: 5_000 })
      .toBe(before);

    // The title link is the same kind of control: an external link only.
    const titleLink = cardFor(page, TITLE).getByTestId('job-title-link');
    await expect(titleLink).toHaveAttribute('href', HEALTHY_QUEUE.jobs[0]!.url);
    await expect(titleLink).toHaveAttribute('target', '_blank');

    // Aplicar: the deliberate action. It records, and the log changes.
    await applyLinkFor(page, TITLE).click();
    await expect
      .poll(async () => (await readApplications()).length, { timeout: 15_000 })
      .toBe(1);
  });
});

test('GENERATED_AT is the frozen clock the relative ages are computed against', () => {
  expect(GENERATED_AT).toBe('2026-03-10T09:00:00.000Z');
});
