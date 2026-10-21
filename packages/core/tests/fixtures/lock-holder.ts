/**
 * Child process that takes the write lock and holds it, so a parent test can
 * observe real contention instead of simulating it.
 *
 * Prints `held` on stdout once the lock is taken, then keeps holding until it is
 * killed or the hold time elapses.
 *
 * Usage: node --import tsx lock-holder.ts <directory> <holdMs>
 */
import { withWriteLock } from '../../src/adapters/persistence/write-lock.js';

const [directory, rawHoldMs] = process.argv.slice(2);
if (directory === undefined || rawHoldMs === undefined) {
  process.stderr.write('usage: lock-holder.ts <directory> <holdMs>\n');
  process.exit(64);
}

const holdMs = Number(rawHoldMs);

await withWriteLock(directory, async () => {
  process.stdout.write('held\n');
  await new Promise<void>((resolve) => setTimeout(resolve, holdMs));
});
