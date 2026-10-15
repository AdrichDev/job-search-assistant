import type { Logger } from '../../ports/logger.js';

/** The only place in the codebase allowed to touch `console` for diagnostics. */
export const consoleLogger: Logger = {
  info: (message) => {
    console.error(`info  ${message}`);
  },
  warn: (message) => {
    console.error(`warn  ${message}`);
  },
  error: (message) => {
    console.error(`error ${message}`);
  },
};
