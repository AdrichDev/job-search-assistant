/**
 * The portal a mail proposal reveals, as a fallback for the tracking table
 * (S5): a row whose imported listing carries no Portal falls back to the one
 * the alert email named. The rule is keyed on "no portal", not on origin, so a
 * queue-made row benefits too; an imported portal is NEVER overwritten, and a
 * row whose proposals name no portal stays without one - an invented portal
 * would be a lie in the user's own table.
 *
 * Pure data shaping, like `tracking-filters.ts`; the tracking page wires it.
 */

/** `jobId` -> portal of the proposals that carry one; the newest proposal wins. */
export function mailPortalByJob(
  proposals: readonly {
    readonly jobId: string;
    readonly portal?: string;
  }[],
): ReadonlyMap<string, string> {
  const portals = new Map<string, string>();
  // Repositories list newest first, so the first portal seen per job is the latest.
  for (const proposal of proposals) {
    if (proposal.portal !== undefined && !portals.has(proposal.jobId)) {
      portals.set(proposal.jobId, proposal.portal);
    }
  }
  return portals;
}

/** Rows with the mail-revealed portal filled in only where none was imported. */
export function withMailPortalFallback<Row extends { readonly jobId: string; readonly portal?: string }>(
  rows: readonly Row[],
  portals: ReadonlyMap<string, string>,
): Row[] {
  return rows.map((row) => {
    if (row.portal !== undefined) {
      return row;
    }
    const portal = portals.get(row.jobId);
    return portal === undefined ? row : { ...row, portal };
  });
}
