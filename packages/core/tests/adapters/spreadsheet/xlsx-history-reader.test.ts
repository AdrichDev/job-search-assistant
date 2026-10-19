import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createXlsxHistoryReader } from '../../../src/adapters/spreadsheet/xlsx-history-reader.js';

export const HEADERS = [
  'Nombre empresa',
  'Puesto / oferta',
  'Fecha publicación',
  'Fecha solicitud',
  'Información breve empresa',
  'Ciudad',
  'Dirección',
  'Teléfono',
  'Persona de contacto',
  'URL de la oferta',
  'Nº listado',
  '¿Han contestado?',
  'Estado',
  'Fecha contestación',
  'Fuente principal',
  'Portal',
];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xlsx-reader-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(
  build: (wb: ExcelJS.Workbook) => void,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const path = join(dir, 'history.xlsx');
  await wb.xlsx.writeFile(path);
  return path;
}

describe('createXlsxHistoryReader', () => {
  it('reads rows, takes the hyperlink target and skips empty rows', async () => {
    const path = await write((wb) => {
      const ws = wb.addWorksheet('Candidaturas');
      ws.addRow(['Extra', ...HEADERS]); // extra leading column is tolerated
      ws.addRow([
        'x',
        'Acme Fictional',
        'Junior Dev',
        new Date('2026-01-05T00:00:00Z'),
        new Date('2026-01-10T00:00:00Z'),
        'Info',
        'Madrid',
        'Calle Falsa 1',
        '000',
        'Pat Doe',
        { text: 'Abrir oferta', hyperlink: 'https://example.test/job/1' },
        '7',
        'No',
        'En proceso',
        null,
        'x',
        'InfoJobs',
      ]);
      ws.addRow([]);
      ws.addRow(['x', null, 'Orphan title']);
    });

    const rows = await createXlsxHistoryReader({ filePath: path }).read();

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.company).toBe('Acme Fictional');
    expect(row.title).toBe('Junior Dev');
    expect(row.url).toBe('https://example.test/job/1');
    expect(row.appliedAt?.toISOString().slice(0, 10)).toBe('2026-01-10');
    expect(row.publishedAt?.toISOString().slice(0, 10)).toBe('2026-01-05');
    expect(row.respondedAt).toBeUndefined();
    expect(row.listNumber).toBe('7');
    expect(row.replied).toBe('No');
    expect(row.status).toBe('En proceso');
    expect(row.portal).toBe('InfoJobs');
    expect(row.rowNumber).toBe(2);
  });

  it('falls back to the cell text when the URL cell has no hyperlink', async () => {
    const path = await write((wb) => {
      const ws = wb.addWorksheet('Candidaturas');
      ws.addRow(HEADERS);
      ws.addRow(['Acme', 'Dev', null, null, null, null, null, null, null, 'https://plain.test/x']);
    });
    const rows = await createXlsxHistoryReader({ filePath: path }).read();
    expect(rows[0]?.url).toBe('https://plain.test/x');
  });

  it('throws a clear error when the sheet is missing', async () => {
    const path = await write((wb) => {
      wb.addWorksheet('Other');
    });
    await expect(createXlsxHistoryReader({ filePath: path }).read()).rejects.toThrow(/Candidaturas/);
  });

  it('throws a clear error naming a missing required header', async () => {
    const path = await write((wb) => {
      const ws = wb.addWorksheet('Candidaturas');
      ws.addRow(HEADERS.filter((h) => h !== 'Estado'));
    });
    await expect(createXlsxHistoryReader({ filePath: path }).read()).rejects.toThrow(/Estado/);
  });
});

/**
 * Real workbooks often carry charts on a summary sheet. exceljs cannot
 * reconcile a drawing that holds only charts and throws while loading, which
 * made the user's real file unreadable even though the history sheet is plain.
 */
async function addChartOnlyDrawingToSecondSheet(path: string): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const sheetPath = 'xl/worksheets/sheet2.xml';
  const sheetXml = await (zip.file(sheetPath) as JSZip.JSZipObject).async('string');
  zip.file(
    sheetPath,
    sheetXml.replace(
      '</worksheet>',
      '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/><legacyDrawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="anysvml"/></worksheet>',
    ),
  );
  zip.file(
    'xl/worksheets/_rels/sheet2.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml" Id="rId1"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="/xl/comments/comment1.xml" Id="comments"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="/xl/drawings/commentsDrawing1.vml" Id="anysvml"/></Relationships>',
  );
  // Comments kept under `xl/comments/`, a path exceljs does not look up.
  zip.file(
    'xl/comments/comment1.xml',
    '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>a</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>note</t></r></text></comment></commentList></comments>',
  );
  zip.file(
    'xl/drawings/commentsDrawing1.vml',
    '<xml xmlns:v="urn:schemas-microsoft-com:vml"></xml>',
  );
  // Unprefixed default namespace, exactly as the real file writes it: exceljs
  // only recognizes the `xdr:` prefixed form and then fails on the anchors.
  zip.file(
    'xl/drawings/drawing1.xml',
    '<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><twoCellAnchor editAs="oneCell"><from><col>11</col><colOff>0</colOff><row>6</row><rowOff>70200</rowOff></from><to><col>20</col><colOff>247680</colOff><row>17</row><rowOff>137160</rowOff></to><graphicFrame><nvGraphicFramePr><cNvPr id="1" name="Chart 1"/><cNvGraphicFramePr/></nvGraphicFramePr><xfrm/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></graphicFrame><clientData/></twoCellAnchor></wsDr>',
  );
  zip.file(
    'xl/drawings/_rels/drawing1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/xl/charts/chart1.xml" Id="rId1"/></Relationships>',
  );
  zip.file(
    'xl/charts/chart1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
  );
  await addAbsolutePathTableToFirstSheet(zip);
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

/** The history sheet itself is a formatted table, referenced by an absolute part path. */
async function addAbsolutePathTableToFirstSheet(zip: JSZip): Promise<void> {
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheetXml = await (zip.file(sheetPath) as JSZip.JSZipObject).async('string');
  zip.file(
    sheetPath,
    sheetXml.replace(
      '</worksheet>',
      '<tableParts count="1"><tablePart xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdTable"/></tableParts></worksheet>',
    ),
  );
  const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  const rels = await (zip.file(relsPath) as JSZip.JSZipObject).async('string');
  zip.file(
    relsPath,
    rels.replace(
      '</Relationships>',
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="/xl/tables/table1.xml" Id="rIdTable"/></Relationships>',
    ),
  );
  zip.file(
    'xl/tables/table1.xml',
    '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Tabla1" displayName="Tabla1" ref="A1:P2" totalsRowShown="0"><tableColumns count="1"><tableColumn id="1" name="c"/></tableColumns></table>',
  );
}

describe('createXlsxHistoryReader - workbooks with charts', () => {
  it('still reads the history sheet when another sheet holds a chart-only drawing', async () => {
    const path = await write((wb) => {
      const ws = wb.addWorksheet('Candidaturas');
      ws.addRow(HEADERS);
      ws.addRow([
        'Acme Fictional',
        'Junior Dev',
        new Date('2026-01-05T00:00:00Z'),
        new Date('2026-01-10T00:00:00Z'),
        'Info',
        'Madrid',
        'Calle Falsa 1',
        '000',
        'Pat Doe',
        { text: 'Abrir oferta', hyperlink: 'https://example.test/job/1' },
        '7',
        'No',
        'En proceso',
        null,
        'x',
        'InfoJobs',
      ]);
      wb.addWorksheet('Resumen').addRow(['Seguimiento']);
    });
    await addChartOnlyDrawingToSecondSheet(path);

    const rows = await createXlsxHistoryReader({ filePath: path }).read();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.company).toBe('Acme Fictional');
    expect(rows[0]?.url).toBe('https://example.test/job/1');
  });
});
