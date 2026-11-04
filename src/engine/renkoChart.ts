import { OHLCV } from '../types';

/** Number of leading candles used to size the fixed Renko box. */
export const RENKO_BOX_SAMPLE_BARS = 200;

/** Close-based fixed-box Renko, for chart visualization only.
 * The box is fixed for the displayed history using 14-bar ATR; the real
 * exchange candles remain authoritative for orders, P&L and KEYS signals.
 */
export function toRenkoCandles(candles: OHLCV[], timeframeMinutes: number): OHLCV[] {
  if (!candles.length) return [];
  const intervalSeconds = Math.max(60, Math.floor(timeframeMinutes * 60));
  const sample = candles.slice(1, Math.min(RENKO_BOX_SAMPLE_BARS, candles.length));
  const ranges = sample.map((c, i) => Math.max(
    c.high - c.low,
    Math.abs(c.high - candles[i].close),
    Math.abs(c.low - candles[i].close)
  ));
  const typicalRange = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : candles[0].close * 0.01;
  const box = Math.max(typicalRange, Math.abs(candles[0].close) * 0.001, 1e-12);
  const result: OHLCV[] = [];
  let lastClose = candles[0].close;
  const maxBricksPerCandle = Math.min(200, intervalSeconds - 1);

  for (const candle of candles) {
    const direction = Math.sign(candle.close - lastClose);
    const bricks = Math.min(maxBricksPerCandle, Math.floor(Math.abs(candle.close - lastClose) / box));
    for (let j = 0; j < bricks; j++) {
      const open = lastClose;
      const close = open + direction * box;
      result.push({
        time: candle.time + Math.floor((j * intervalSeconds) / maxBricksPerCandle),
        open,
        high: j === bricks - 1 ? Math.max(open, close, candle.high) : Math.max(open, close),
        low: j === bricks - 1 ? Math.min(open, close, candle.low) : Math.min(open, close),
        close,
        volume: candle.volume / bricks
      });
      lastClose = close;
    }
  }
  return result;
}
