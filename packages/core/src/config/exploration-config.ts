/**
 * RETIRED alongside `domain/exploration.ts`. Nothing reads these values.
 *
 * The product stopped ordering by score, which is the only thing an exploration
 * quota can counteract. Kept unwired rather than deleted because this repository
 * has no version control; see the header of `domain/exploration.ts`.
 *
 * Exploration quota defaults.
 *
 * 15% is a deliberate product choice, not a tuned number: it is large enough
 * that the application log accumulates evidence about jobs the ranking did NOT
 * favour, and small enough that the candidate's limited daily applications are
 * still mostly spent on the best bets.
 */
export const DEFAULT_EXPLORATION_RATE = 0.15;

/**
 * Seed with day granularity.
 *
 * Stable within a day, so re-rendering the page or re-running the CLI does not
 * reshuffle the list under the candidate's feet, and it rotates every day so
 * the exploration quota eventually covers different parts of the ranking.
 */
export function dailyExplorationSeed(now: Date): string {
  return `exploration-${now.toISOString().slice(0, 10)}`;
}
