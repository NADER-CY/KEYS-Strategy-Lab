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
  const sourceByTime = new Map(sourceCandles.map((c) => [c.time, c.close]));
  const source = candles.map((c, i) => sourceByTime.get(c.time) ?? sourceCandles[i]?.close ?? c.close);
  const buySignals: IndicatorSignals['buySignals'] = [];
  const sellSignals: IndicatorSignals['sellSignals'] = [];
  const stops: IndicatorSignals['plots'][number]['data'] = [];
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
      buySignals.push({ time: c.time, price: c.low, reason: `UT Bot BUY | ATR ${length} | Key ${sensitivity}` });
    }
    if (i >= length && src < stop && prevSrc >= previousStop) {
      sellSignals.push({ time: c.time, price: c.high, reason: `UT Bot SELL | ATR ${length} | Key ${sensitivity}` });
    }
    stops.push({ time: c.time, value: stop });
    previousStop = stop;
  }

  return {
    buySignals,
    sellSignals,
    plots: [{ name: 'UT Bot ATR Trailing Stop', color: '#3D6BFF', linewidth: 2, data: stops }]
  };
}
