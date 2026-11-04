import { IndicatorSignals, OHLCV } from '../types';
import { toHeikinAshiCandles } from './indicatorCalculations';

/** UT Bot Alerts (Pine v4) ATR trailing-stop crossing logic. */
export function calculateUtBotSignals(
  candles: OHLCV[],
  params: Record<string, unknown> = {},
  heikinSourceCandles: OHLCV[] = candles
): IndicatorSignals {
  const length = Math.max(1, Math.floor(Number(params.c ?? 10)));
  const sensitivity = Math.max(0.000001, Number(params.a ?? 1));
  const useHeikinSource = params.h === true || params.h === 'true';
  const sourceCandles = useHeikinSource ? toHeikinAshiCandles(heikinSourceCandles) : candles;
  // Index alignment is the common case (same candle timeline); fall back to a
  // time lookup only when the series differ (e.g. Renko bricks).
  const closeAtTime = (series: OHLCV[]) => {
    let byTime: Map<number, number> | null = null;
    return (i: number, time: number) => {
      if (series[i]?.time === time) return series[i].close;
      byTime ??= new Map(series.map((c) => [c.time, c.close]));
      return byTime.get(time);
    };
  };
  const sourceClose = closeAtTime(sourceCandles);
  const source = candles.map((c, i) => sourceClose(i, c.time) ?? sourceCandles[i]?.close ?? c.close);
  // Signal labels show the real exchange close at the signal bar (heikinSource
  // candles are the raw exchange candles except in Renko mode, where the brick
  // close is the traded level). Heikin Ashi closes are synthetic averages.
  const referenceClose = closeAtTime(heikinSourceCandles);
  const buySignals: IndicatorSignals['buySignals'] = [];
  const sellSignals: IndicatorSignals['sellSignals'] = [];
  const stopTimes: number[] = [];
  const stopValues: number[] = [];
  let atr = 0;
  let trueRangeSum = 0;
  let previousStop = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const previousClose = i > 0 ? candles[i - 1].close : c.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose));
    if (i < length) {
      trueRangeSum += tr;
      if (i === length - 1) atr = trueRangeSum / length;
    } else {
      atr = ((atr * (length - 1)) + tr) / length;
    }
    if (i < length - 1) continue;

    const src = source[i];
    const prevSrc = i > 0 ? source[i - 1] : src;
    const loss = sensitivity * atr;
    const stop = src > previousStop && prevSrc > previousStop
      ? Math.max(previousStop, src - loss)
      : src < previousStop && prevSrc < previousStop
        ? Math.min(previousStop, src + loss)
        : src > previousStop ? src - loss : src + loss;

    // ema(src, 1) equals src; Pine crossover checks previous bar's values.
    if (i >= length && src > stop && prevSrc <= previousStop) {
      buySignals.push({ time: c.time, price: referenceClose(i, c.time) ?? c.close, reason: `UT Bot BUY | ATR ${length} | Key ${sensitivity}` });
    }
    if (i >= length && src < stop && prevSrc >= previousStop) {
      sellSignals.push({ time: c.time, price: referenceClose(i, c.time) ?? c.close, reason: `UT Bot SELL | ATR ${length} | Key ${sensitivity}` });
    }
    stopTimes.push(c.time);
    stopValues.push(stop);
    previousStop = stop;
  }

  const result: IndicatorSignals = { buySignals, sellSignals, plots: [] };
  let plotsCache: IndicatorSignals['plots'] | null = null;
  // Built lazily: overlays are off by default and this array is large.
  Object.defineProperty(result, 'plots', {
    enumerable: true,
    configurable: true,
    get() {
      plotsCache ??= [{
        name: 'UT Bot ATR Trailing Stop', color: '#3D6BFF', linewidth: 2,
        data: stopTimes.map((time, i) => ({ time, value: stopValues[i] }))
      }];
      return plotsCache;
    }
  });
  return result;
}
