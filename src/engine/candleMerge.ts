import { OHLCV } from '../types';

function lowerBound(candles: OHLCV[], time: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].time < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function sortedUnique(bars: OHLCV[]): OHLCV[] {
  const byTime = new Map<number, OHLCV>();
  bars.forEach((bar) => byTime.set(bar.time, bar));
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Merge a small window of recent bars into a long, sorted history without
 * re-sorting it (O(window) instead of O(n log n) for ~100k bars per poll).
 * Returns `previous` itself when nothing changed so React can skip renders.
 * `cap` trims the oldest bars only once the history exceeds it by `slack`,
 * so the chart can append bars without rewriting the whole series each time.
 */
export function mergeRecentCandles(previous: OHLCV[], recent: OHLCV[], cap: number, slack = 2000): OHLCV[] {
  if (!recent.length) return previous;
  const incoming = sortedUnique(recent);
  if (!previous.length) return incoming.slice(-cap);
  const start = lowerBound(previous, incoming[0].time);
  const tail = previous.slice(start);
  let changed = false;
  const merged = new Map<number, OHLCV>();
  tail.forEach((bar) => merged.set(bar.time, bar));
  for (const bar of incoming) {
    const old = merged.get(bar.time);
    if (!old || old.open !== bar.open || old.high !== bar.high || old.low !== bar.low ||
        old.close !== bar.close || old.volume !== bar.volume) {
      changed = true;
      merged.set(bar.time, bar);
    }
  }
  if (!changed) return previous;
  const next = previous.slice(0, start).concat([...merged.values()].sort((a, b) => a.time - b.time));
  return next.length > cap + slack ? next.slice(-cap) : next;
}

/** Prepend an older history page (pages arrive newest-first while paging back). */
export function mergeOlderCandles(previous: OHLCV[], older: OHLCV[], cutoff: number, cap: number): OHLCV[] {
  if (!older.length) return previous;
  const firstKept = previous.length ? previous[0].time : Infinity;
  const prefix = sortedUnique(older).filter((bar) => bar.time >= cutoff && bar.time < firstKept);
  if (!prefix.length) return previous;
  const next = prefix.concat(previous);
  return next.length > cap ? next.slice(next.length - cap) : next;
}
