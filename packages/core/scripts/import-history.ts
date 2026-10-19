import { resolve } from 'node:path';
import { createJsonApplicationRepository } from '../src/adapters/persistence/json-application-repository.js';
import { createXlsxHistoryReader } from '../src/adapters/spreadsheet/xlsx-history-reader.js';
import { importApplicationHistory } from '../src/app/import-application-history.js';
import { consoleLogger } from '../src/adapters/logging/console-logger.js';
import { DEFAULT_APPLICATION_LOG_PATH } from '../src/config/paths.js';

/**
 * `npm run import:history -- <path-to-xlsx> [--applications=PATH]`
 *
 * Prints counts only. The spreadsheet holds personal data, so company names,
 * contacts and any other cell content are never written to the console.
 */

const USAGE = 'Usage: npm run import:history -- <path-to-xlsx> [--applications=PATH]';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const applicationsArg = args.find((arg) => arg.startsWith('--applications='));
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const xlsxPath = positional[0];

  if (xlsxPath === undefined || positional.length !== 1) {
    consoleLogger.error(USAGE);
    return 1;
  }

  const applicationsPath =
    applicationsArg === undefined
      ? DEFAULT_APPLICATION_LOG_PATH
      : resolve(applicationsArg.slice('--applications='.length));

  const rows = await createXlsxHistoryReader({ filePath: resolve(xlsxPath) }).read();
  const repository = createJsonApplicationRepository({ filePath: applicationsPath });
  const result = await importApplicationHistory(rows, { repository });

  console.log(`Imported:         ${result.imported}`);
  console.log(`Already imported: ${result.alreadyImported}`);
  console.log(`Matched existing: ${result.matchedExisting} (state updated: ${result.updatedExisting})`);
  console.log(`Skipped:          ${result.skipped.length}`);
  for (const skipped of result.skipped) {
    console.log(`  row ${skipped.rowNumber}: ${skipped.reason}`);
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    consoleLogger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
