/** A portfolio cycle starts at its first filled entry, never at data-window start. */
export function cycleElapsedSeconds(firstEntryTime: number | null, currentTime: number): number | null {
  return firstEntryTime === null ? null : Math.max(0, currentTime - firstEntryTime);
}

export function hasCycleReachedExpiry(firstEntryTime: number | null, currentTime: number, maxDays: number, hasOpenPositions: boolean): boolean {
  const elapsed = cycleElapsedSeconds(firstEntryTime, currentTime);
  return hasOpenPositions && elapsed !== null && elapsed >= maxDays * 86400;
}
