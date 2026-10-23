import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { seedApplications, type SeedApplication } from '../support/workspace.js';

/**
 * The tracking view (CU5/CU6): every application in one place, imported ones
 * included. Fixtures are shaped like the real log: imported rows carry a
 * listing and NO cvVariant/score, one queue-made row is a legacy 3-part
 * fingerprint with no sourceIds whose job is no longer queued, listing fields
 * have accents and absent keys, and urls are a mix of safe and unsafe.
 */

const QUEUED_JOB = HEALTHY_QUEUE.jobs[0];
if (QUEUED_JOB === undefined) {
  throw new Error('The healthy queue fixture is empty.');
}

const COMPANY_INFO = 'Consultora tecnológica.\n\nSector: banca\n  Equipo de 40 personas <b>';

const APPLICATIONS: readonly SeedApplication[] = [
  {
    // Imported, safe url, still waiting.
    jobId: 'import-aaaa1111',
    appliedAt: '2026-03-01T00:00:00.000Z',
    sourceIds: ['infojobs'],
    outcome: 'applied',
    listing: {
      company: 'Información Ñandú S.L.',
      title: 'Desarrollador Júnior Frontend',
      url: 'https://empleo.example.test/oferta/1',
      portal: 'InfoJobs',
      city: 'Alcobendas',
      companyInfo: COMPANY_INFO,
      publishedAt: '2026-02-27T00:00:00.000Z',
      address: 'Calle Imaginaria 12, Madrid',
      phone: '600123456',
      contact: 'Marta Pérez (RR. HH.)',
    },
  },
  {
    // Imported, rejected with a reply date, unsafe url, a note.
    jobId: 'import-bbbb2222',
    appliedAt: '2026-02-20T00:00:00.000Z',
    sourceIds: ['web-de-la-empresa'],
    outcome: 'rejected',
    outcomeUpdatedAt: '2026-03-02T00:00:00.000Z',
    notes: 'Respondieron por correo',
    listing: {
      company: 'Cañas y Tapas Tech',
      title: 'Programador Júnior',
      url: 'javascript:alert(1)',
      portal: 'Web de la empresa',
    },
  },
  {
    // Legacy queue-made: 3-part fingerprint, no sourceIds, job not in the queue.
    jobId: 'beta soluciones::qa júnior::barcelona',
    appliedAt: '2026-02-10T00:00:00.000Z',
    cvVariant: 'general',
    scoreAtApply: 61,
    outcome: 'screening',
    outcomeUpdatedAt: '2026-02-15T00:00:00.000Z',
  },
  {
    // Queue-made and still in the queue: facts come from the queue entry.
    jobId: QUEUED_JOB.id,
    appliedAt: '2026-03-05T00:00:00.000Z',
    cvVariant: 'frontend',
    scoreAtApply: 80,
    sourceIds: ['greenhouse'],
    outcome: 'offer',
    outcomeUpdatedAt: '2026-03-08T00:00:00.000Z',
  },
  {
    // Imported, non-web url, no reply, no city.
    jobId: 'import-cccc3333',
    appliedAt: '2026-01-15T00:00:00.000Z',
    sourceIds: ['linkedin'],
    outcome: 'no_reply',
    listing: {
      company: 'Wizbii Iberia',
      title: 'Analista Júnior',
      url: 'ftp://files.example.test/x',
      // Publication date but no company info: the date must still be reachable.
      publishedAt: '2026-01-10T00:00:00.000Z',
    },
  },
];

const rowFor = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title });
const filterNav = (page: Page) => page.getByRole('navigation', { name: 'Filtrar por estado' });

test.describe('tracking view', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(APPLICATIONS);
  });

  test('lists every application, imported ones included, newest first', async ({ page }) => {
    await page.goto('/seguimiento');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seguimiento de postulaciones');
    await expect(page.getByText('5 postulaciones', { exact: true })).toBeVisible();

    const bodyRows = page.locator('tbody tr');
    await expect(bodyRows).toHaveCount(5);
    await expect(bodyRows.nth(0)).toContainText(QUEUED_JOB.title);
    await expect(bodyRows.nth(1)).toContainText('Información Ñandú S.L.');
    await expect(bodyRows.nth(2)).toContainText('Cañas y Tapas Tech');
    await expect(bodyRows.nth(3)).toContainText('beta soluciones');
    await expect(bodyRows.nth(4)).toContainText('Wizbii Iberia');

    // UI-2: with fewer rows than one page there is no pagination nav at all.
    await expect(page.getByRole('navigation', { name: 'Paginación' })).toHaveCount(0);
  });

  test('each row shows company, title, source, city and state', async ({ page }) => {
    await page.goto('/seguimiento');

    const imported = rowFor(page, 'Desarrollador Júnior Frontend');
    await expect(imported).toContainText('Información Ñandú S.L.');
    await expect(imported).toContainText('InfoJobs');
    await expect(imported).toContainText('Alcobendas');
    await expect(imported).toContainText('1 mar 2026');
    await expect(imported).toContainText('Aplicada');

    // Resolved from the queue entry: the log row has no listing.
    const queued = rowFor(page, QUEUED_JOB.title);
    await expect(queued).toContainText(QUEUED_JOB.company);
    await expect(queued).toContainText('Greenhouse');
    await expect(queued).toContainText(QUEUED_JOB.location);
    await expect(queued).toContainText('Oferta');

    // Parsed from the fingerprint: the job left the queue and nothing else is known.
    const legacy = rowFor(page, 'qa júnior');
    await expect(legacy).toContainText('beta soluciones');
    await expect(legacy).toContainText('barcelona');
    await expect(legacy).toContainText('Fuente no registrada');
    await expect(legacy).toContainText('Preselección');
  });

  test('company info is available on demand in an accessible detail, with its publication date', async ({
    page,
  }) => {
    await page.goto('/seguimiento');
    const row = rowFor(page, 'Desarrollador Júnior Frontend');
    const detail = row.locator('details');
    await expect(detail).toHaveCount(1);
    const summary = detail.locator('summary');
    await expect(summary).toHaveText('Información breve empresa');
    await expect(row.getByText('Información breve empresa', { exact: true })).toBeVisible();
    // Closed until asked for: the text is not on screen, and it opens by keyboard-reachable summary.
    await expect(detail).not.toHaveAttribute('open', '');
    await expect(detail.getByText('Sector: banca', { exact: false })).toBeHidden();

    await summary.click();
    await expect(detail).toHaveAttribute('open', '');
    const body = detail.getByText('Sector: banca', { exact: false });
    await expect(body).toBeVisible();
    // Exact text: newlines and indentation kept, markup escaped (React) and shown as text.
    expect(await body.evaluate((node) => node.textContent)).toBe(COMPANY_INFO);
    expect(await body.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('pre-wrap');
    await expect(detail.getByText('27 feb 2026', { exact: false })).toBeVisible();

    // Other rows have no company info: no empty control.
    await expect(rowFor(page, 'Programador Júnior').locator('details')).toHaveCount(0);
  });

  test('a row with a publication date but no company info still offers the date on demand', async ({
    page,
  }) => {
    await page.goto('/seguimiento');
    const row = rowFor(page, 'Analista J\u00fanior');
    const detail = row.locator('details');
    await expect(detail).toHaveCount(1);
    const summary = detail.locator('summary');
    await expect(summary).toHaveText('Fecha de publicaci\u00f3n');
    // Not mislabelled as company info, and no empty company-info text.
    await expect(row).not.toContainText('Informaci\u00f3n breve empresa');
    await expect(detail.getByText('10 ene 2026')).toBeHidden();

    await summary.click();
    await expect(detail.getByText('10 ene 2026')).toBeVisible();
    expect(await detail.locator('p').count()).toBe(1);
    // UI-2 added the ¿Contestó? column: 11 columns since then, on purpose.
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(11);
  });

  test('address, phone and contact stay out of the table and the column count is unchanged', async ({
    page,
  }) => {
    await page.goto('/seguimiento');
    // UI-2 added the ¿Contestó? column: 11 columns since then, on purpose.
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(11);
    await expect(page.locator('main table')).not.toContainText('Calle Imaginaria');
    await expect(page.locator('main table')).not.toContainText('600123456');
    await expect(page.locator('main table')).not.toContainText('Marta Pérez');
    await expect(page.locator('main table')).not.toContainText('Teléfono');
    await expect(page.locator('main table')).not.toContainText('Dirección');
  });

  test('the response date appears only for responses, and notes are shown', async ({ page }) => {
    await page.goto('/seguimiento');

    const rejected = rowFor(page, 'Programador Júnior');
    await expect(rejected).toContainText('Web de la empresa');
    await expect(rejected).toContainText('Rechazada');
    await expect(rejected).toContainText('2 mar 2026');
    await expect(rejected).toContainText('Respondieron por correo');
    await expect(rejected.locator('time')).toHaveCount(2);

    // Applied date plus the publication date that lives inside the company-info detail.
    await expect(rowFor(page, 'Desarrollador Júnior Frontend').locator('time')).toHaveCount(2);
    // Applied date plus the publication date inside its detail.
    await expect(rowFor(page, 'Analista Júnior').locator('time')).toHaveCount(2);
  });

  test('the offer link exists only for http(s) urls and opens safely', async ({ page }) => {
    await page.goto('/seguimiento');

    const links = page.getByRole('link', { name: /^Abrir oferta/ });
    await expect(links).toHaveCount(2); // imported https + queue entry url
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveAttribute('href', /^https?:\/\//);
    }
    await expect(rowFor(page, 'Programador Júnior').getByRole('link', { name: /Abrir oferta/ })).toHaveCount(0);
    await expect(rowFor(page, 'Analista Júnior').getByRole('link', { name: /Abrir oferta/ })).toHaveCount(0);
    await expect(
      rowFor(page, 'Desarrollador Júnior Frontend').getByRole('link', { name: /Abrir oferta/ }),
    ).toHaveAttribute('href', 'https://empleo.example.test/oferta/1');
  });

  test('Estado and ¿Contestó? cells use the spreadsheet colours and keep their words', async ({ page }) => {
    await page.goto('/seguimiento');

    const estadoCell = (title: string) => rowFor(page, title).locator('td').nth(4);
    const replyCell = (title: string) => rowFor(page, title).locator('td').nth(5);
    const computed = (locator: ReturnType<typeof rowFor>, property: string) =>
      locator.evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop), property);

    // Rechazada: red cell, and ¿Contestó? is a green Sí.
    const rejected = estadoCell('Programador Júnior');
    await expect(rejected).toHaveText('Rechazada');
    expect(await computed(rejected, 'background-color')).toBe('rgb(254, 226, 226)');
    expect(await computed(rejected, 'color')).toBe('rgb(153, 27, 27)');
    const si = replyCell('Programador Júnior');
    await expect(si).toHaveText('Sí');
    expect(await computed(si, 'background-color')).toBe('rgb(220, 252, 231)');
    expect(await computed(si, 'color')).toBe('rgb(22, 101, 52)');

    // Preselección: blue bold cell, Sí.
    const screening = estadoCell('qa júnior');
    await expect(screening).toHaveText('Preselección');
    expect(await computed(screening, 'background-color')).toBe('rgb(219, 234, 254)');
    expect(await computed(screening, 'color')).toBe('rgb(29, 78, 216)');
    expect(Number(await computed(screening, 'font-weight'))).toBeGreaterThanOrEqual(700);
    await expect(replyCell('qa júnior')).toHaveText('Sí');

    // Oferta: green bold cell, Sí.
    const offer = estadoCell(QUEUED_JOB.title);
    await expect(offer).toHaveText('Oferta');
    expect(await computed(offer, 'background-color')).toBe('rgb(220, 252, 231)');
    expect(await computed(offer, 'color')).toBe('rgb(22, 101, 52)');
    expect(Number(await computed(offer, 'font-weight'))).toBeGreaterThanOrEqual(700);
    await expect(replyCell(QUEUED_JOB.title)).toHaveText('Sí');

    // Aplicada: blue cell, and ¿Contestó? is a red No.
    const applied = estadoCell('Desarrollador Júnior Frontend');
    await expect(applied).toHaveText('Aplicada');
    expect(await computed(applied, 'background-color')).toBe('rgb(219, 234, 254)');
    const no = replyCell('Desarrollador Júnior Frontend');
    await expect(no).toHaveText('No');
    expect(await computed(no, 'background-color')).toBe('rgb(254, 226, 226)');
    expect(await computed(no, 'color')).toBe('rgb(153, 27, 27)');

    // Sin respuesta: the neutral style (no Excel equivalent).
    const noReply = estadoCell('Analista Júnior');
    await expect(noReply).toHaveText('Sin respuesta');
    expect(await computed(noReply, 'background-color')).toBe('rgb(226, 232, 240)');
    expect(await computed(noReply, 'color')).toBe('rgb(51, 65, 85)');
    await expect(replyCell('Analista Júnior')).toHaveText('No');
  });

  test('the outcome filter works through the query string with counts', async ({ page }) => {
    await page.goto('/seguimiento');

    const filter = filterNav(page);
    for (const text of [
      'Todas (5)',
      'Aplicada (1)',
      'Sin respuesta (1)',
      'Rechazada (1)',
      'Preselección (1)',
      'Entrevista (0)',
      'Oferta (1)',
    ]) {
      await expect(filter.getByRole('link', { name: text, exact: true })).toBeVisible();
    }
    await expect(filter.getByRole('link', { name: 'Todas (5)' })).toHaveAttribute('aria-current', 'true');

    await filter.getByRole('link', { name: 'Rechazada (1)' }).click();
    await expect(page).toHaveURL(/\/seguimiento\?estado=rejected$/);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('Cañas y Tapas Tech');
    await expect(filter.getByRole('link', { name: 'Rechazada (1)' })).toHaveAttribute('aria-current', 'true');
    await expect(filter.getByRole('link', { name: 'Todas (5)' })).not.toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('Mostrando 1–1 de 1 postulación')).toBeVisible();

    // A filter with no match is explained, with a way back.
    await filter.getByRole('link', { name: 'Entrevista (0)' }).click();
    await expect(page.getByText('Ninguna postulación está en el estado «Entrevista»')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.getByRole('link', { name: 'Ver todas' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(5);
  });

  test('an unknown estado falls back to all', async ({ page }) => {
    await page.goto('/seguimiento?estado=__proto__');
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await page.goto('/seguimiento?estado=nope');
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await expect(filterNav(page).getByRole('link', { name: 'Todas (5)' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('shows a Spanish empty state when there are no applications', async ({ page }) => {
    await seedApplications([]);
    await page.goto('/seguimiento');

    await expect(page.getByText('Todavía no hay postulaciones registradas').first()).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('the navigation links both pages and marks the current one', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Secciones' });
    await expect(nav.getByRole('link', { name: 'Ofertas' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Seguimiento' })).not.toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Seguimiento' }).click();
    await expect(page).toHaveURL(/\/seguimiento$/);
    await expect(nav.getByRole('link', { name: 'Seguimiento' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Ofertas' })).not.toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Ofertas' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(nav.getByRole('link', { name: 'Ofertas' })).toHaveAttribute('aria-current', 'page');
  });

  test('no untranslated English leaks into the tracking page', async ({ page }) => {
    await page.goto('/seguimiento');
    const text = (await page.locator('body').innerText()).toLowerCase();

    for (const english of [
      'open offer',
      'applied',
      'rejected',
      'no_reply',
      'screening',
      'interview',
      'notes',
      'company',
    ]) {
      expect(text, `found untranslated copy: "${english}"`).not.toMatch(new RegExp(`\\b${english}\\b`));
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Seguimiento de postulaciones/);
  });
});

const PAGE_APPLICATIONS: readonly SeedApplication[] = [
  ...APPLICATIONS,
  // Ten more applied rows, all older than the base seed, so the ordering of
  // the first page stays exactly the five rows the other tests know. 15 rows
  // in total (2 pages), 11 of them applied (2 pages inside the filter too).
  ...Array.from({ length: 10 }, (_unused, index) => ({
    jobId: `import-paginada-${index + 1}`,
    appliedAt: `2026-01-${String(14 - index).padStart(2, '0')}T00:00:00.000Z`,
    sourceIds: ['infojobs'],
    outcome: 'applied',
    listing: {
      company: `Paginada Empresa ${index + 1}`,
      title: `Puesto paginado ${index + 1}`,
    },
  })),
];

const paginationNav = (page: Page) => page.getByRole('navigation', { name: 'Paginación' });

test('the Estado and ¿Contestó? headers use the spreadsheet colours too', async ({
  seed,
  page,
}) => {
  /*
   * UI-2 gave the CELLS the colours of the user's Excel. The user then asked for
   * the column headings to match ("también el de los títulos de las columnas"),
   * because a coloured column with a grey heading reads as two different tables.
   */
  await seed(HEALTHY_QUEUE);
  await seedApplications([
    {
      jobId: 'header-1',
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      listing: { company: 'Acme Sistemas', title: 'Desarrollador Backend Júnior' },
    },
  ]);
  await page.goto('/seguimiento');

  const header = (name: string) => page.locator('th', { hasText: name }).first();
  const estado = await header('Estado').evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const contesto = await header('¿Contestó?').evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  expect(estado).toBe('rgb(219, 234, 254)');
  expect(contesto).toBe('rgb(220, 252, 231)');
});

test('the table reads like the spreadsheet: a filled header band and gridlines', async ({
  seed,
  page,
}) => {
  /*
   * Point 5 of the list: the applications table must look like the user's Excel,
   * headings included. The two spreadsheet columns keep their own pastel fills;
   * every other heading sits on the dark header band, and the cells are ruled so
   * the table reads as a sheet instead of floating rows.
   */
  await seed(HEALTHY_QUEUE);
  await seedApplications([
    {
      jobId: 'sheet-1',
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      listing: { company: 'Acme Sistemas', title: 'Desarrollador Backend Júnior' },
    },
  ]);
  await page.goto('/seguimiento');

  const header = (name: string) => page.locator('th', { hasText: name }).first();
  expect(await header('Empresa').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(31, 56, 100)',
  );
  expect(await header('Estado').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(219, 234, 254)',
  );

  const cell = page.locator('tbody td').first();
  const border = await cell.evaluate((el) => getComputedStyle(el).borderRightWidth);
  expect(border).not.toBe('0px');
});

test.describe('tracking view pagination', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(PAGE_APPLICATIONS);
  });

  test('shows 10 rows per page with a working nav and aria-disabled edges', async ({ page }) => {
    await page.goto('/seguimiento');

    await expect(page.locator('tbody tr')).toHaveCount(10);
    await expect(page.getByText('Mostrando 1–10 de 15 postulaciones')).toBeVisible();

    const nav = paginationNav(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByText('Página 1 de 2')).toBeVisible();
    // Unavailable edges are not links and say so.
    await expect(nav.getByText('Primera')).toHaveAttribute('aria-disabled', 'true');
    await expect(nav.getByText('Anterior')).toHaveAttribute('aria-disabled', 'true');
    await expect(nav.getByRole('link', { name: 'Primera' })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Siguiente' }).click();
    await expect(page).toHaveURL(/pagina=2/);
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await expect(page.getByText('Mostrando 11–15 de 15 postulaciones')).toBeVisible();
    await expect(nav.getByText('Página 2 de 2')).toBeVisible();
    await expect(nav.getByText('Siguiente')).toHaveAttribute('aria-disabled', 'true');
    await expect(nav.getByText('Última')).toHaveAttribute('aria-disabled', 'true');

    await nav.getByRole('link', { name: 'Primera' }).click();
    await expect(page).toHaveURL(/pagina=1/);
    await expect(page.locator('tbody tr')).toHaveCount(10);
    // Última jumps straight to the last page.
    await paginationNav(page).getByRole('link', { name: 'Última' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(5);
    // Anterior steps back one page.
    await paginationNav(page).getByRole('link', { name: 'Anterior' }).click();
    await expect(page).toHaveURL(/pagina=1/);
  });

  test('an out-of-range page clamps to the last one and garbage shows page 1', async ({ page }) => {
    await page.goto('/seguimiento?pagina=999');
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await expect(page.getByText('Página 2 de 2')).toBeVisible();

    await page.goto('/seguimiento?pagina=abc');
    await expect(page.locator('tbody tr')).toHaveCount(10);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
  });

  test('the nav preserves estado, and choosing a filter resets to page 1', async ({ page }) => {
    // 11 of the 13 applications are applied: two pages inside the filter too.
    await page.goto('/seguimiento?estado=applied&pagina=1');
    await expect(page.locator('tbody tr')).toHaveCount(10);

    await paginationNav(page).getByRole('link', { name: 'Siguiente' }).click();
    await expect(page).toHaveURL(/estado=applied&pagina=2/);
    await expect(page.locator('tbody tr')).toHaveCount(1);

    // Going back through the filter drops pagina: page 1 again.
    await page.goto('/seguimiento?pagina=2');
    await filterNav(page).getByRole('link', { name: 'Aplicada (11)' }).click();
    await expect(page).toHaveURL(/\/seguimiento\?estado=applied$/);
    await expect(page.locator('tbody tr')).toHaveCount(10);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
  });
});

test.describe('tracking view accessibility', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(APPLICATIONS);
  });

  test('one main landmark, one h1, a captioned table with scoped headers', async ({ page }) => {
    await page.goto('/seguimiento');

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('table', { name: /Postulaciones con su empresa/ })).toBeVisible();
    // UI-2 added the ¿Contestó? column: 11 columns since then, on purpose.
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(11);
    await expect(page.locator('tbody th[scope="row"]')).toHaveCount(5);
    // Layout tables are forbidden: the only table is the data table.
    await expect(page.locator('table')).toHaveCount(1);
  });

  test('the skip link is first and lands on the table page', async ({ page }) => {
    await page.goto('/seguimiento');
    await expect(page.getByRole('link').first()).toContainText('Saltar a la tabla de seguimiento');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#seguimiento$/);
  });

  test('the filter is reachable by keyboard and the offer link names its job', async ({ page }) => {
    await page.goto('/seguimiento');
    await expect(
      page.getByRole('link', { name: /Abrir oferta de Desarrollador Júnior Frontend/ }),
    ).toBeVisible();

    const filterLink = page.getByRole('link', { name: 'Oferta (1)' });
    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await filterLink.evaluate((node) => node === document.activeElement);
    }
    expect(reached, 'the filter link was not reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/estado=offer/);
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('a normal session produces no console errors', async ({ page, console: log }) => {
    await page.goto('/seguimiento');
    await page.getByRole('link', { name: 'Rechazada (1)' }).click();
    await page.getByRole('link', { name: 'Ofertas', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    const appErrors = log.errors.filter(
      (message) => !/ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource/i.test(message),
    );
    expect(appErrors, `console errors:\n${appErrors.join('\n')}`).toEqual([]);
    expect(log.pageErrors, `uncaught exceptions:\n${log.pageErrors.join('\n')}`).toEqual([]);
  });
});
