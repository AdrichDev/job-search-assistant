import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { HistoryReader, HistoryRow } from '../../ports/history-reader.js';

/**
 * Reads the user's historical spreadsheet (sheet `Candidaturas`).
 *
 * Headers are matched by exact trimmed text, so extra columns and any column
 * order are tolerated. The file holds personal data: nothing here logs cells.
 */

export const HISTORY_SHEET_NAME = 'Candidaturas';

const HEADERS = {
  company: 'Nombre empresa',
  title: 'Puesto / oferta',
  publishedAt: 'Fecha publicación',
  appliedAt: 'Fecha solicitud',
  companyInfo: 'Información breve empresa',
  city: 'Ciudad',
  address: 'Dirección',
  phone: 'Teléfono',
  contact: 'Persona de contacto',
  url: 'URL de la oferta',
  listNumber: 'Nº listado',
  replied: '¿Han contestado?',
  status: 'Estado',
  respondedAt: 'Fecha contestación',
  portal: 'Portal',
} as const;

type Field = keyof typeof HEADERS;

export interface XlsxHistoryReaderOptions {
  readonly filePath: string;
}

function textOf(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    if ('richText' in value) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('hyperlink' in value) {
      return String(value.text !== undefined ? textOf(value.text as ExcelJS.CellValue) : value.hyperlink).trim();
    }
    if ('result' in value) {
      return textOf(value.result as ExcelJS.CellValue);
    }
    if ('error' in value) {
      return '';
    }
  }
  return String(value).trim();
}

function dateOf(value: ExcelJS.CellValue): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (value !== null && typeof value === 'object' && 'result' in value) {
    return dateOf(value.result as ExcelJS.CellValue);
  }
  return undefined;
}

function urlOf(value: ExcelJS.CellValue): string {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'hyperlink' in value) {
    const target = String(value.hyperlink).trim();
    if (target.length > 0) {
      return target;
    }
  }
  return textOf(value);
}

const REMOVED_PARTS = /^xl\/(drawings\/|charts\/|comments|tables\/)/;
const SHEET_PART = /^xl\/worksheets\/sheet\d+\.xml$/;
const SHEET_RELS_PART = /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/;

/**
 * Removes drawings, charts, comments and tables from an in-memory copy of the workbook.
 *
 * Real spreadsheets keep charts on a summary sheet, and exceljs throws while
 * loading a drawing written without the `xdr:` prefix, and comments or tables
 * that the file references by absolute part path instead of the relative one it
 * expects. Each made the user's real file unreadable although the history sheet
 * is plain cells. This reader needs
 * cell values and hyperlinks only, so nothing it uses is lost. The file on disk
 * is never modified.
 */
async function withoutDrawings(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    if (REMOVED_PARTS.test(name)) {
      zip.remove(name);
    } else if (SHEET_PART.test(name)) {
      const xml = await (zip.file(name) as JSZip.JSZipObject).async('string');
      zip.file(
        name,
        xml
          .replace(/<(drawing|legacyDrawing)\s[^>]*\/>/g, '')
          .replace(/<tableParts[\s\S]*?<\/tableParts>/g, ''),
      );
    } else if (SHEET_RELS_PART.test(name)) {
      const xml = await (zip.file(name) as JSZip.JSZipObject).async('string');
      zip.file(name, xml.replace(/<Relationship\s[^>]*relationships\/(drawing|vmlDrawing|comments|table)"[^>]*\/>/g, ''));
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

export function createXlsxHistoryReader(options: XlsxHistoryReaderOptions): HistoryReader {
  return {
    async read(): Promise<readonly HistoryRow[]> {
      const workbook = new ExcelJS.Workbook();
      // exceljs declares its own `Buffer` type (an ArrayBuffer), which Node's
      // Buffer does not satisfy even though it works at runtime.
      const cleaned = await withoutDrawings(await readFile(options.filePath));
      await workbook.xlsx.load(cleaned as unknown as Parameters<typeof workbook.xlsx.load>[0]);

      const sheet = workbook.getWorksheet(HISTORY_SHEET_NAME);
      if (sheet === undefined) {
        throw new Error(`The spreadsheet has no sheet named "${HISTORY_SHEET_NAME}".`);
      }

      const columns = new Map<string, number>();
      sheet.getRow(1).eachCell((cell, column) => {
        const header = textOf(cell.value);
        if (header.length > 0 && !columns.has(header)) {
          columns.set(header, column);
        }
      });

      const missing = Object.values(HEADERS).filter((header) => !columns.has(header));
      if (missing.length > 0) {
        throw new Error(`The "${HISTORY_SHEET_NAME}" sheet is missing required column(s): ${missing.join(', ')}.`);
      }

      const columnOf = (field: Field): number => columns.get(HEADERS[field]) as number;
      const rows: HistoryRow[] = [];

      sheet.eachRow((sheetRow, rowNumber) => {
        if (rowNumber === 1) {
          return;
        }
        const raw = (field: Field): ExcelJS.CellValue => sheetRow.getCell(columnOf(field)).value;
        const text = (field: Field): string => textOf(raw(field));
        const company = text('company');
        if (company.length === 0) {
          return;
        }
        const publishedAt = dateOf(raw('publishedAt'));
        const appliedAt = dateOf(raw('appliedAt'));
        const respondedAt = dateOf(raw('respondedAt'));
        rows.push({
          rowNumber,
          company,
          title: text('title'),
          ...(publishedAt === undefined ? {} : { publishedAt }),
          ...(appliedAt === undefined ? {} : { appliedAt }),
          companyInfo: text('companyInfo'),
          city: text('city'),
          address: text('address'),
          phone: text('phone'),
          contact: text('contact'),
          url: urlOf(raw('url')),
          listNumber: text('listNumber'),
          replied: text('replied'),
          status: text('status'),
          ...(respondedAt === undefined ? {} : { respondedAt }),
          portal: text('portal'),
        });
      });

      return rows;
    },
  };
}
