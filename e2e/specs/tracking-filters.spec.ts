import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { seedApplications, type SeedApplication } from '../support/workspace.js';

/**
 * S1: the tracking table is filtered like the user's own spreadsheet.
 *
 * The vocabulary is the spreadsheet's: company, job title, city, portal,
 * state, whether anyone replied, and the two dates. The filtering happens on
 * the server, so a combination is a URL: it survives a reload, a link can
 * carry it, pagination keeps it, and any change lands on page 1.
 *
 * The seed is 13 rows so the unfiltered table has two pages (10 + 3): a filter
 * change that must reset the page needs a page to reset FROM.
 */

const INFOJOBS_ROWS: readonly SeedApplication[] = Array.from({ length: 11 }, (_unused, index) => ({
  jobId: `filtro-infojobs-${index + 1}`,
  appliedAt: '2026-03-01T00:00:00.000Z',
  sourceIds: ['infojobs'],
  outcome: 'applied',
  listing: {
    company: 'Ñandú Sistemas',
    title: `Puesto Ñandú ${index + 1}`,
    portal: 'InfoJobs',
    city: 'Alcobendas',
    publishedAt: '2026-02-01T00:00:00.000Z',
  },
}));

const OTHER_ROWS: readonly SeedApplication[] = [
  {
    jobId: 'filtro-rechazada',
    appliedAt: '2026-02-10T00:00:00.000Z',
    sourceIds: ['web-de-la-empresa'],
    outcome: 'rejected',
    outcomeUpdatedAt: '2026-02-20T00:00:00.000Z',
    listing: {
      company: 'Otra Empresa',
      title: 'Puesto rechazado',
      portal: 'LinkedIn',
      city: 'Madrid',
    },
  },
  {
    jobId: 'filtro-silencio',
    appliedAt: '2026-02-11T00:00:00.000Z',
    sourceIds: ['linkedin'],
    outcome: 'no_reply',
    listing: {
      company: 'Otra Empresa Dos',
      title: 'Puesto silencio',
      portal: 'Indeed',
      city: 'Getafe',
    },
  },
];

const SEED_ROWS: readonly SeedApplication[] = [...INFOJOBS_ROWS, ...OTHER_ROWS];

const form = (page: Page) =>
  page.getByRole('form', { name: 'Filtrar el historial de postulaciones' });

test.beforeEach(async ({ seed }) => {
  await seed(HEALTHY_QUEUE);
  await seedApplications(SEED_ROWS);
});

test('a combination filters the table through a plain form submit', async ({ page }) => {
  await page.goto('/seguimiento');

  await form(page).getByLabel('Empresa', { exact: true }).fill('Ñandú');
  await form(page).getByLabel('Ciudad', { exact: true }).fill('Alcobendas');
  await form(page).getByRole('button', { name: 'Aplicar filtros' }).click();

  await expect(page).toHaveURL(/empresa=%C3%91and%C3%BA/);
  await expect(page).toHaveURL(/ciudad=Alcobendas/);

  // The 11 Ñandú rows fill page 1; the other two companies are gone.
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.locator('tbody tr').first()).toContainText('Ñandú Sistemas');
  await expect(page.getByRole('table')).not.toContainText('Otra Empresa');
});

test('the combination survives a reload as a shareable link', async ({ page }) => {
  await page.goto('/seguimiento?empresa=otra');

  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByLabel('Empresa', { exact: true })).toHaveValue('otra');

  await page.reload();

  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByLabel('Empresa', { exact: true })).toHaveValue('otra');
});

test('the estado counts are computed under the other active filters', async ({ page }) => {
  await page.goto('/seguimiento');

  await form(page).getByLabel('Empresa', { exact: true }).fill('Ñandú');
  await form(page).getByRole('button', { name: 'Aplicar filtros' }).click();

  const nav = page.getByRole('navigation', { name: 'Filtrar por estado' });
  // Under the company filter the log is 11 applied rows, nothing else.
  await expect(nav.getByRole('link', { name: 'Todas (11)' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Aplicada (11)' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Rechazada (0)' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Oferta (0)' })).toBeVisible();
});

test('¿han contestado? and the dates filter on their own', async ({ page }) => {
  await page.goto('/seguimiento?contestado=si');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Puesto rechazado');

  await page.goto('/seguimiento?contestado=no');
  // 12 of the 13 rows got no reply: two pages, ten on the first.
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByText('Mostrando 1–10 de 12 postulaciones')).toBeVisible();

  // The 11 Ñandú rows were applied on 1 March; the rest earlier that month.
  await page.goto('/seguimiento?desde=2026-03-01');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByText('Mostrando 1–10 de 11 postulaciones')).toBeVisible();

  await page.goto('/seguimiento?hasta=2026-02-28');
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('pagination keeps every filter, and changing a filter returns to page 1', async ({ page }) => {
  // Deep page of the unfiltered table first.
  await page.goto('/seguimiento?pagina=2');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.getByText('Página 2 de 2')).toBeVisible();

  // A filter change from here lands on page 1 of the filtered subset.
  await form(page).getByLabel('Empresa', { exact: true }).fill('Ñandú');
  await form(page).getByRole('button', { name: 'Aplicar filtros' }).click();

  await expect(page).toHaveURL(/empresa=/);
  await expect(page).not.toHaveURL(/pagina=/);
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByText('Página 1 de 2')).toBeVisible();

  // And pagination preserves the filter it moves under.
  await page
    .getByRole('navigation', { name: 'Paginación' })
    .getByRole('link', { name: 'Siguiente' })
    .click();
  await expect(page).toHaveURL(/empresa=/);
  await expect(page).toHaveURL(/pagina=2/);
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('an estado link keeps the other filters and drops the page', async ({ page }) => {
  // Page 2 of the Ñandú subset: one row, deep in the filter.
  await page.goto('/seguimiento?empresa=%C3%91and%C3%BA&pagina=2');
  await expect(page.getByText('Página 2 de 2')).toBeVisible();

  // Under this company filter nothing is rejected, and the link says so (0).
  // Clicking it keeps the company filter, drops the page and explains the emptiness.
  await page
    .getByRole('navigation', { name: 'Filtrar por estado' })
    .getByRole('link', { name: 'Rechazada (0)' })
    .click();

  await expect(page).toHaveURL(/empresa=/);
  await expect(page).toHaveURL(/estado=rejected/);
  await expect(page).not.toHaveURL(/pagina=/);
  await expect(page.getByText('Ninguna postulación coincide con los filtros')).toBeVisible();
});

test('a combination with no match explains itself and offers a way back', async ({ page }) => {
  await page.goto('/seguimiento?empresa=zutano&ciudad=toledo');

  await expect(page.getByText('Ninguna postulación coincide con los filtros')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  await page.getByRole('link', { name: 'Limpiar filtros y ver todas' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(10);
});

test('an unknown portal value falls back to every row', async ({ page }) => {
  await page.goto('/seguimiento?portal=milanuncios');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByText('Mostrando 1–10 de 13 postulaciones')).toBeVisible();
});
