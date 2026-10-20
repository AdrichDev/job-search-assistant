import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { JobQueue, QueueWriter } from '../../ports/queue-writer.js';

export interface JsonFileQueueWriterOptions {
  readonly filePath: string;
}

/**
 * Writes the ranked queue as pretty JSON.
 *
 * This is the seam where a database, a Notion board or an email digest will
 * plug in later: they only have to satisfy `QueueWriter`.
 */
export function createJsonFileQueueWriter(options: JsonFileQueueWriterOptions): QueueWriter {
  return {
    async write(queue: JobQueue): Promise<string> {
      const target = resolve(options.filePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
      return target;
    },
  };
}
