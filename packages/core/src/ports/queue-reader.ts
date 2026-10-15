import type { JobQueue } from './queue-writer.js';

/**
 * Driven port: loads a previously persisted queue.
 *
 * Exists so the web app can render the last CLI run without re-fetching from a
 * job board on every page view. Returns null when no run has been persisted
 * yet - a missing queue is an expected state, not an error.
 */
export interface QueueReader {
  read(): Promise<JobQueue | null>;
}
