import type { Logger } from '../../src/ports/logger.js';

export interface RecordingLogger extends Logger {
  readonly messages: { level: 'info' | 'warn' | 'error'; message: string }[];
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createRecordingLogger(): RecordingLogger {
  const messages: { level: 'info' | 'warn' | 'error'; message: string }[] = [];
  return {
    messages,
    info: (message) => messages.push({ level: 'info', message }),
    warn: (message) => messages.push({ level: 'warn', message }),
    error: (message) => messages.push({ level: 'error', message }),
  };
}
