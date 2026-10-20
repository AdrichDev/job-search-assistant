import { readFile, writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import {
  SCRATCH_APPLICATIONS_PATH,
  SCRATCH_HISTORY_PATH,
  readApplications,
  readHistory,
  seedApplications,
  writeHistoryFile,
  type SeedApplication,
} from '../support/workspace.js';

/**
 * Change history and undo (CU7, T2c). Fixtures are shaped like the real log:
 * imported rows carry a listing and NO cvVariant/score (sourceIds like
 * ['infojobs']), one queue-made row is a legacy 3-part fingerprint with no
 * listing and no sourceIds, names carry accents and ñ, and one note is very long.
 *
 * Every assertion that matters is made twice: on the screen and on the isolated
 * files the server really wrote (`readApplications`, `readHistory`).
 */

const IMPORTED_ID = 'import-aaaa1111';
const LEGACY_ID = 'beta soluciones::qa júnior::barcelona';
const LONG_NOTE = `${'Nota larga con ñ y acentos. '.repeat(120)}fin`;

const APPLICATIONS: readonly SeedApplication[] = [
  {
    jobId: IMPORTED_ID,
    appliedAt: '2026-03-01T00:00:00.000Z',
    sourceIds: ['infojobs'],
    outcome: 'applied',
    notes: LONG_NOTE,
    listing: {
      company: 'Información Ñandú S.L.',
      title: 'Desarrollador Júnior Frontend',
      url: 'https://empleo.example.test/oferta/1',
      portal: 'InfoJobs',
      city: 'Alcobendas',
    },
  },
  {
    jobId: LEGACY_ID,
    appliedAt: '2026-02-10T12:34:56.000Z',
    cvVariant: 'general',
    scoreAtApply: 61,
    outcome: 'screening',
    outcomeUpdatedAt: '2026-02-15T12:34:56.000Z',
  },
];

const editUrl = (jobId: string) => `/seguimiento/${encodeURIComponent(jobId)}/editar`;
const historyTable = (page: Page) => page.getByRole('table', { name: /Cambios de esta postulación/ });
const undoButtons = (page: Page): Locator => historyTable(page).getByRole('button', { name: /Deshacer/ });
const entryRows = (page: Page): Locator => historyTable(page).locator('tbody tr');
const storedApplications = () => readFile(SCRATCH_APPLICATIONS_PATH, 'utf8');

async function save(page: Page, jobId: string, fields: Record<string, string>): Promise<void> {
  await page.goto(editUrl(jobId));
  for (const [label, value] of Object.entries(fields)) {
    const control = page.getByLabel(label, { exact: true });
    if ((await control.evaluate((node) => node.tagName)) === 'SELECT') {
      await control.selectOption(value);
    } else {
      await control.fill(value);
    }
  }
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page).toHaveURL(/edicion=guardada/);
}

async function originalApplication(jobId: string) {
  const found = (await readApplications()).find((entry) => entry.jobId === jobId);
  expect(found, `seeded application ${jobId} not found`).toBeDefined();
  return found;
}

test.describe('change history', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(APPLICATIONS);
  });

  test('an application with no changes shows the Spanish empty state and no undo', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await expect(page.getByRole('heading', { level: 2, name: 'Historial de cambios' })).toBeVisible();
    await expect(page.getByText('Todavía no hay cambios anotados')).toBeVisible();
    await expect(historyTable(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Deshacer/ })).toHaveCount(0);
    expect(await readHistory()).toEqual([]);
  });

  test('two edits give two entries, newest first, and only the newest can be undone', async ({ page }) => {
    await save(page, IMPORTED_ID, { 'Estado de la postulación': 'rejected', Notas: 'Rechazo por correo ñandú' });
    await save(page, IMPORTED_ID, { Ciudad: '', 'CV enviado': 'frontend' });

    const history = await readHistory();
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.source)).toEqual(['manual', 'manual']);
    expect(history[0]?.changes.map((change) => change.field)).toEqual(['outcome', 'outcomeUpdatedAt', 'notes']);
    expect(history[0]?.changes[0]).toEqual({ field: 'outcome', before: 'applied', after: 'rejected' });
    expect(history[0]?.changes[2]?.before).toBe(LONG_NOTE);
    expect(history[1]?.changes).toEqual([
      { field: 'cvVariant', before: null, after: 'frontend' },
      { field: 'listing.city', before: 'Alcobendas', after: null },
    ]);

    await page.goto(editUrl(IMPORTED_ID));
    await expect(entryRows(page)).toHaveCount(2);
    // Newest first: the second edit is the first row.
    await expect(entryRows(page).nth(0)).toContainText('CV enviado');
    await expect(entryRows(page).nth(0)).toContainText('Ciudad');
    await expect(entryRows(page).nth(0)).toContainText('vacío');
    await expect(entryRows(page).nth(1)).toContainText('Estado de la postulación');
    await expect(entryRows(page).nth(1)).toContainText('Rechazada');
    await expect(entryRows(page)).toHaveText([/Manual/, /Manual/]);
    // The long note is cut on screen but whole in the log.
    const shown = await entryRows(page).nth(1).innerText();
    expect(shown.length).toBeLessThan(900);
    expect(shown).toContain('…');

    await expect(undoButtons(page)).toHaveCount(1);
    await expect(entryRows(page).nth(0).getByRole('button', { name: /Deshacer/ })).toBeVisible();
    await expect(entryRows(page).nth(1).getByRole('button')).toHaveCount(0);
  });

  test('undoing the latest restores the values, adds a Deshacer entry and unlocks the older entry', async ({
    page,
  }) => {
    const original = await originalApplication(IMPORTED_ID);
    await save(page, IMPORTED_ID, { 'Estado de la postulación': 'rejected', Notas: 'Rechazo por correo ñandú' });
    await save(page, IMPORTED_ID, { Ciudad: '', 'CV enviado': 'frontend' });
    await page.goto(editUrl(IMPORTED_ID));
    await expect(undoButtons(page)).toHaveCount(1);

    await undoButtons(page).first().click();
    await expect(page).toHaveURL(/deshacer=deshecho/);
    await expect(page.getByRole('status').filter({ hasText: 'Cambio deshecho.' })).toBeVisible();

    // The form shows the restored values of the SECOND edit only.
    await expect(page.getByLabel('Ciudad', { exact: true })).toHaveValue('Alcobendas');
    await expect(page.getByLabel('CV enviado', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue('Rechazo por correo ñandú');
    await expect(page.getByLabel('Estado de la postulación', { exact: true })).toHaveValue('rejected');

    await expect(entryRows(page)).toHaveCount(3);
    await expect(entryRows(page).nth(0)).toContainText('Deshacer');
    await expect(entryRows(page).nth(0)).toContainText('Deshace el cambio del');
    await expect(entryRows(page).nth(1)).toContainText('Deshecho');
    await expect(entryRows(page).nth(2)).not.toContainText('Deshecho');

    const history = await readHistory();
    expect(history).toHaveLength(3);
    expect(history[2]?.source).toBe('revert');
    expect(history[2]?.revertsId).toBe(history[1]?.id);

    // The older entry is undoable only now: the undo of the undo and the older entry.
    await expect(undoButtons(page)).toHaveCount(2);
    await expect(entryRows(page).nth(2).getByRole('button', { name: /Deshacer/ })).toBeVisible();
    await expect(entryRows(page).nth(1).getByRole('button')).toHaveCount(0);

    await entryRows(page).nth(2).getByRole('button', { name: /Deshacer/ }).click();
    await expect(page).toHaveURL(/deshacer=deshecho/);
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue(LONG_NOTE);
    await expect(page.getByLabel('Estado de la postulación', { exact: true })).toHaveValue('applied');
    // Everything is back, field by field, in the stored file.
    expect(await originalApplication(IMPORTED_ID)).toEqual(original);
    expect(await readHistory()).toHaveLength(4);
  });

  test('a legacy queue-made row: edit, undo, every stored value restored (dates keep their time)', async ({ page }) => {
    const before = await readApplications();
    await save(page, LEGACY_ID, { 'Estado de la postulación': 'rejected', Notas: 'sin suerte' });
    expect(await readApplications()).not.toEqual(before);
    await page.goto(editUrl(LEGACY_ID));
    await expect(entryRows(page)).toHaveCount(1);
    await undoButtons(page).first().click();
    await expect(page).toHaveURL(/deshacer=deshecho/);
    expect(await readApplications()).toEqual(before);
    const stored = await originalApplication(LEGACY_ID);
    expect(stored?.appliedAt).toBe('2026-02-10T12:34:56.000Z');
    expect(stored?.scoreAtApply).toBe(61);
  });

  test('undoing the creation of a listing on a legacy row keeps company and title (documented limitation)', async ({
    page,
  }) => {
    await save(page, LEGACY_ID, { Ciudad: 'Girona' });
    const created = (await readHistory())[0];
    expect(created?.changes.map((change) => change.field)).toEqual(['listing.company', 'listing.title', 'listing.city']);
    await page.goto(editUrl(LEGACY_ID));
    await undoButtons(page).first().click();
    await expect(page).toHaveURL(/deshacer=deshecho/);
    const raw = JSON.parse(await storedApplications()) as {
      applications: { jobId: string; listing?: Record<string, unknown> }[];
    };
    const legacy = raw.applications.find((entry) => entry.jobId === LEGACY_ID);
    expect(legacy?.listing).toEqual({ company: 'beta soluciones', title: 'qa júnior' });
  });

  test('a change made outside the history is a conflict: Spanish message, nothing changes', async ({ page }) => {
    await save(page, IMPORTED_ID, { Notas: 'dentro del historial' });
    await page.goto(editUrl(IMPORTED_ID));
    await expect(undoButtons(page)).toHaveCount(1);

    // Someone edits the isolated log by hand while the page is open.
    const raw = JSON.parse(await storedApplications()) as {
      applications: { jobId: string; notes?: string }[];
    };
    const target = raw.applications.find((entry) => entry.jobId === IMPORTED_ID);
    if (target === undefined) throw new Error('seed');
    target.notes = 'cambiada a mano fuera de la app';
    await writeFile(SCRATCH_APPLICATIONS_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    const applicationsBefore = await storedApplications();
    const historyBefore = await readFile(SCRATCH_HISTORY_PATH, 'utf8');

    await undoButtons(page).first().click();
    await expect(page).toHaveURL(/deshacer=conflicto/);
    await expect(page.getByRole('status').filter({ hasText: 'se modificó fuera del historial' })).toBeVisible();
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue('cambiada a mano fuera de la app');
    expect(await storedApplications()).toBe(applicationsBefore);
    expect(await readFile(SCRATCH_HISTORY_PATH, 'utf8')).toBe(historyBefore);
    await expect(entryRows(page)).toHaveCount(1);
  });

  test('a stale page cannot undo an entry that is no longer the latest', async ({ page, context }) => {
    await save(page, IMPORTED_ID, { Notas: 'uno' });
    await save(page, IMPORTED_ID, { Notas: 'dos' });
    await page.goto(editUrl(IMPORTED_ID));
    await expect(undoButtons(page)).toHaveCount(1);

    const other = await context.newPage();
    await save(other, IMPORTED_ID, { Notas: 'tres' });
    await other.close();

    await undoButtons(page).first().click();
    await expect(page).toHaveURL(/deshacer=no-ultimo/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Solo se puede deshacer el último cambio que sigue vigente' }),
    ).toBeVisible();
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue('tres');
    expect(await readHistory()).toHaveLength(3);
  });

  test('a stale page cannot undo the same entry twice', async ({ page, context }) => {
    await save(page, IMPORTED_ID, { Notas: 'uno' });
    await page.goto(editUrl(IMPORTED_ID));

    const other = await context.newPage();
    await other.goto(editUrl(IMPORTED_ID));
    await undoButtons(other).first().click();
    await expect(other).toHaveURL(/deshacer=deshecho/);
    await other.close();

    await undoButtons(page).first().click();
    await expect(page).toHaveURL(/deshacer=ya-deshecho/);
    await expect(page.getByRole('status').filter({ hasText: 'Ese cambio ya se había deshecho.' })).toBeVisible();
    expect(await readHistory()).toHaveLength(2);
  });

  test('keyboard only: Tab reaches Deshacer with a visible focus ring and Enter undoes', async ({ page }) => {
    await save(page, IMPORTED_ID, { Notas: 'solo teclado' });
    await page.goto(editUrl(IMPORTED_ID));
    const button = undoButtons(page).first();
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await button.evaluate((node) => node === document.activeElement);
    }
    expect(reached, 'the Deshacer button was not reachable by Tab').toBe(true);

    const focus = await button.evaluate((node) => {
      const style = getComputedStyle(node);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
    });
    expect(
      (focus.outlineStyle !== 'none' && focus.outlineWidth !== '0px') || focus.boxShadow !== 'none',
      `no visible focus indicator: ${JSON.stringify(focus)}`,
    ).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/deshacer=deshecho/);
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue(LONG_NOTE);
  });

  test('accessibility: one h1, one main, a captioned table with column headers, named buttons, no console errors', async ({
    page,
    console: capture,
  }) => {
    await save(page, IMPORTED_ID, { Notas: 'uno' });
    await save(page, IMPORTED_ID, { Notas: 'dos' });
    await page.goto(editUrl(IMPORTED_ID));

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(historyTable(page)).toHaveCount(1);
    await expect(historyTable(page).getByRole('columnheader')).toHaveText(['Fecha', 'Origen', 'Cambios', 'Acción']);
    await expect(page.getByRole('region', { name: 'Historial de cambios' })).toHaveCount(1);

    const names = await undoButtons(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    expect(names.every((name) => name !== null && name.startsWith('Deshacer el cambio del'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);

    // Every form control still has a label (the hidden entry id is not a control).
    const unlabeled = await page
      .locator('main input:not([type="hidden"]), main select, main textarea')
      .evaluateAll((nodes) =>
        nodes.filter((node) => !(node as HTMLInputElement).labels?.length).map((node) => node.getAttribute('name')),
      );
    expect(unlabeled).toEqual([]);

    expect(capture.errors).toEqual([]);
    expect(capture.pageErrors).toEqual([]);
  });

  test('no English leaks into the history, for every kind of entry and every notice', async ({ page }) => {
    await save(page, IMPORTED_ID, { 'Estado de la postulación': 'screening', 'CV enviado': 'microsoft' });
    // An import entry and a long-note entry, written straight to the isolated history.
    const manual = (await readHistory())[0];
    const longNote = 'Ñ'.repeat(20_000);
    await writeHistoryFile(
      `${JSON.stringify(
        {
          version: 1,
          changes: [
            {
              id: 'import-entry-1',
              jobId: IMPORTED_ID,
              at: '2020-04-01T08:00:00.000Z',
              source: 'import',
              changes: [
                { field: 'sourceIds', before: ['infojobs'], after: ['infojobs', 'linkedin'] },
                { field: 'listing.publishedAt', before: null, after: '2026-02-27T00:00:00.000Z' },
                { field: 'appliedAt', before: '2026-03-02T00:00:00.000Z', after: '2026-03-01T00:00:00.000Z' },
              ],
            },
            manual,
            {
              id: 'long-entry-3',
              jobId: IMPORTED_ID,
              at: '2099-12-01T08:00:00.000Z',
              source: 'manual',
              changes: [{ field: 'notes', before: longNote, after: '' }],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    await page.goto(editUrl(IMPORTED_ID));
    await expect(entryRows(page)).toHaveCount(3);
    const section = (await page.getByRole('region', { name: 'Historial de cambios' }).innerText()).toLowerCase();
    for (const english of [
      'before',
      'after',
      'undo',
      'revert',
      'history',
      'imported',
      'screening',
      'microsoft cv',
      'applied',
      'empty',
      'listing',
      'outcome',
      'notes',
      'null',
    ]) {
      expect(section, `found untranslated copy: "${english}"`).not.toMatch(new RegExp(`\\b${english}\\b`));
    }
    expect(section).not.toContain('listing.');
    expect(section).not.toMatch(/\b[a-z]+_[a-z]+\b/);
    expect(section).toContain('importación');
    expect(section).toContain('preselección');
    const longRow = await entryRows(page).nth(0).innerText();
    expect(longRow.length).toBeLessThan(600);

    // Every refusal notice is Spanish too.
    for (const code of ['no-encontrado', 'ya-deshecho', 'no-ultimo', 'conflicto', 'invalido', 'deshecho-sin-registro']) {
      await page.goto(`${editUrl(IMPORTED_ID)}?deshacer=${code}`);
      const notice = (await page.getByRole('status').filter({ hasText: /\S/ }).first().innerText()).toLowerCase();
      expect(notice, code).not.toMatch(/\b(change|undone|could not|cannot|already|history|outside)\b/);
    }
    // An unknown code shows no notice at all.
    await page.goto(`${editUrl(IMPORTED_ID)}?deshacer=<script>`);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('an unreadable history degrades to a visible warning and never to a crash', async ({ page }) => {
    await writeHistoryFile('{ this is not json');
    const response = await page.goto(editUrl(IMPORTED_ID));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Editar postulación');
    await expect(page.locator('main [role="alert"]')).toContainText('No se pudo leer el historial');
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeVisible();

    // Editing still saves, warns that it was not logged, and never overwrites the broken file.
    const before = await storedApplications();
    await page.getByLabel('Notas', { exact: true }).fill('se guarda aunque el historial falle');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=sin-registro$/);
    await expect(
      page.getByRole('status').filter({ hasText: 'no se pudo anotar el cambio en el historial' }),
    ).toBeVisible();
    expect(await storedApplications()).not.toBe(before);
    expect((await originalApplication(IMPORTED_ID))?.notes).toBe('se guarda aunque el historial falle');
    expect(await readFile(SCRATCH_HISTORY_PATH, 'utf8')).toBe('{ this is not json');
  });

  test('refused and unchanged edits write no history', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await page.getByLabel('Enlace de la oferta', { exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('No se guardó nada');
    await page.goto(editUrl(IMPORTED_ID));
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=sin-cambios$/);
    expect(await readHistory()).toEqual([]);
  });
});
