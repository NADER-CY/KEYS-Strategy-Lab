/**
 * Accurate Technical Analysis calculations replicating Pine Script v6 built-in functions
 */
import { OHLCV, IndicatorSignals } from '../types';

export interface KeysIndicatorOptions {
  length?: number; // default 200
  wick_threshold?: number; // default 0.6
  volumeSMA_Period?: number; // default 20
  volume_multiplier?: number; // default 1.5
  rsiPeriod?: number; // default 14
  rsiOversold_Level?: number; // default 30
  rsiOverbought_Level?: number; // default 70
  adxlen?: number; // default 14
  dilen?: number; // default 14
  Adx_trendThreshold?: number; // default 30
  useSARFilter?: boolean; // default true
  sarStart?: number; // default 0.02
  sarIncrement?: number; // default 0.02
  sarMaximum?: number; // default 0.2
}

/**
 * TradingView Heikin Ashi bars calculated from exchange OHLCV.
 * Keep exchange volume unchanged: TradingView's Pine `volume` is not synthetic.
 * Do not use these synthetic prices for actual order fills or P&L valuation.
 */
export function toHeikinAshiCandles(candles: OHLCV[]): OHLCV[] {
  let previousOpen = 0;
  let previousClose = 0;
  return candles.map((c, index) => {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = index === 0 ? (c.open + c.close) / 2 : (previousOpen + previousClose) / 2;
    previousOpen = open;
    previousClose = close;
    return {
      time: c.time,
      open,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      close,
      volume: c.volume
    };
  });
}

/**
 * Simple Moving Average
 */
export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) {
      sum -= data[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

/**
 * Exponential Moving Average
 */
export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
  }
  if (data.length < period) return result;
  let prevEma = sum / period;
  result[period - 1] = prevEma;

  for (let i = period; i < data.length; i++) {
    prevEma = data[i] * k + prevEma * (1 - k);
    result[i] = prevEma;
  }
  return result;
}

/**
 * RMA - Wilder's Running Moving Average (used in RSI, ADX, ATR in Pine Script)
 * rma = alpha * x + (1 - alpha) * prev_rma, where alpha = 1 / length
 */
export function rma(data: number[], length: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  const alpha = 1 / length;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < data.length; i++) {
    if (isNaN(data[i])) continue;
    if (count < length) {
      sum += data[i];
      count++;
      if (count === length) {
        result[i] = sum / length;
      }
    } else {
      const prev = result[i - 1] ?? (sum / length);
      result[i] = alpha * data[i] + (1 - alpha) * prev;
    }
  }
  return result;
}

/**
 * Relative Strength Index (ta.rsi)
 */
export function rsi(close: number[], period = 14): (number | null)[] {
  // Pine ta.rsi uses ta.change(close); the first difference is na, not zero.
  const gains: number[] = [NaN];
  const losses: number[] = [NaN];

  for (let i = 1; i < close.length; i++) {
    const change = close[i] - close[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  const avgGains = rma(gains, period);
  const avgLosses = rma(losses, period);
  const result: (number | null)[] = new Array(close.length).fill(null);

  for (let i = 0; i < close.length; i++) {
    const ag = avgGains[i];
    const al = avgLosses[i];
    if (ag === null || al === null) continue;
    if (al === 0) {
      result[i] = ag === 0 ? 50 : 100;
    } else {
      const rs = ag / al;
      result[i] = 100 - 100 / (1 + rs);
    }
  }
  return result;
}

/**
 * ADX calculation matching Pine Script ta.adx / dirmov
 */
export function adx(
  high: number[],
  low: number[],
  close: number[],
  diLen = 14,
  adxLen = 14
): { adx: (number | null)[]; plusDI: (number | null)[]; minusDI: (number | null)[] } {
  const n = close.length;
  if (n === 0) return { adx: [], plusDI: [], minusDI: [] };
  const trArr: number[] = [high[0] - low[0]];
  // Pine dirmov uses ta.change(high/low), both undefined on the first bar.
  const plusDM: number[] = [NaN];
  const minusDM: number[] = [NaN];

  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);

    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    trArr.push(Math.max(hl, hc, lc));
  }

  const truerange = rma(trArr, diLen);
  const rmaPlusDM = rma(plusDM, diLen);
  const rmaMinusDM = rma(minusDM, diLen);

  const plusDIArr: (number | null)[] = new Array(n).fill(null);
  const minusDIArr: (number | null)[] = new Array(n).fill(null);
  const dxArr: number[] = [];

  for (let i = 0; i < n; i++) {
    const tr = truerange[i];
    const pdm = rmaPlusDM[i];
    const mdm = rmaMinusDM[i];

    if (tr !== null && pdm !== null && mdm !== null && tr > 0) {
      const pdi = (100 * pdm) / tr;
      const mdi = (100 * mdm) / tr;
      plusDIArr[i] = pdi;
      minusDIArr[i] = mdi;
      const sum = pdi + mdi;
      const diff = Math.abs(pdi - mdi);
      dxArr.push(sum === 0 ? 0 : (100 * diff) / sum);
    } else {
      // Do not seed the ADX moving average with invalid pre-warmup bars.
      dxArr.push(NaN);
    }
  }

  const adxResult = rma(dxArr, adxLen);

  return {
    adx: adxResult,
    plusDI: plusDIArr,
    minusDI: minusDIArr
  };
}

/**
 * Parabolic SAR calculation matching ta.sar(start, inc, max)
 */
export function parabolicSar(
  high: number[],
  low: number[],
  start = 0.02,
  inc = 0.02,
  max = 0.2,
  close?: number[]
): { sar: number[]; isBullish: boolean[] } {
  const n = high.length;
  const sar: number[] = new Array(n).fill(NaN);
  const isBullish: boolean[] = new Array(n).fill(true);

  if (n < 2) return { sar, isBullish };

  // Faithful Pine ta.sar reference ordering: initialize on bar 1 using the
  // prior close, detect reversal BEFORE clamping to the previous lows/highs,
  // and do not accelerate on the first bar of a new trend.
  let isUp = (close?.[1] ?? (high[1] + low[1]) / 2) >
    (close?.[0] ?? (high[0] + low[0]) / 2);
  let af = start;
  let ep = isUp ? high[1] : low[1];
  let curSar = isUp ? low[0] : high[0];

  for (let i = 1; i < n; i++) {
    let isFirstTrendBar = i === 1;
    let nextSar = curSar + af * (ep - curSar);

    if (isUp) {
      if (nextSar > low[i]) {
        isFirstTrendBar = true;
        isUp = false;
        nextSar = Math.max(high[i], ep);
        ep = low[i];
        af = start;
      }
    } else {
      if (nextSar < high[i]) {
        isFirstTrendBar = true;
        isUp = true;
        nextSar = Math.min(low[i], ep);
        ep = high[i];
        af = start;
      }
    }

    if (!isFirstTrendBar) {
      if (isUp && high[i] > ep) {
        ep = high[i];
        af = Math.min(af + inc, max);
      } else if (!isUp && low[i] < ep) {
        ep = low[i];
        af = Math.min(af + inc, max);
      }
    }

    nextSar = isUp
      ? Math.min(nextSar, low[i - 1], i > 1 ? low[i - 2] : low[i - 1])
      : Math.max(nextSar, high[i - 1], i > 1 ? high[i - 2] : high[i - 1]);
    curSar = nextSar;
    sar[i] = curSar;
    isBullish[i] = isUp;
  }

  return { sar, isBullish };
}

/**
 * Calculates Highest High and Lowest Low over period `length`
 */
export function rollingExtreme(
  values: number[],
  length: number,
  mode: 'highest' | 'lowest'
): number[] {
  const result: number[] = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - length + 1);
    let extreme = values[start];
    for (let j = start + 1; j <= i; j++) {
      if (mode === 'highest') {
        if (values[j] > extreme) extreme = values[j];
      } else {
        if (values[j] < extreme) extreme = values[j];
      }
    }
    result[i] = extreme;
  }
  return result;
}

/**
 * Full KEYS Strategy indicator calculation over OHLCV candles
 */
export function calculateKeysIndicator(
  candles: OHLCV[],
  options: KeysIndicatorOptions = {}
): IndicatorSignals & {
  sarValues: number[];
  sarBullish: boolean[];
  adxValues: (number | null)[];
  rsiValues: (number | null)[];
} {
  const length = Number(options.length ?? 200);
  const wick_threshold = Number(options.wick_threshold ?? 0.6);
  const volumeSMA_Period = Number(options.volumeSMA_Period ?? 20);
  const volume_multiplier = Number(options.volume_multiplier ?? 1.5);
  const rsiPeriod = Number(options.rsiPeriod ?? 14);
  const rsiOversold_Level = Number(options.rsiOversold_Level ?? 30);
  const rsiOverbought_Level = Number(options.rsiOverbought_Level ?? 70);
  const adxlen = Number(options.adxlen ?? 14);
  const dilen = Number(options.dilen ?? 14);
  const Adx_trendThreshold = Number(options.Adx_trendThreshold ?? 30);
  const useSARFilter = Boolean(options.useSARFilter ?? true);
  const sarStart = Number(options.sarStart ?? 0.02);
  const sarIncrement = Number(options.sarIncrement ?? 0.02);
  const sarMaximum = Number(options.sarMaximum ?? 0.2);

  const n = candles.length;
  if (n === 0) {
    return {
      buySignals: [],
      sellSignals: [],
      plots: [],
      sarValues: [],
      sarBullish: [],
      adxValues: [],
      rsiValues: []
    };
  }

  // The user's TradingView AKEUSDT 15m CSV contains Heikin Ashi OHLC (its
  // exported SELL shape is 2026-09-19 08:00 UTC). Calculate indicator signals
  // on those same synthetic candles; execution still uses real Bybit OHLC.
  const signalCandles = toHeikinAshiCandles(candles);
  const opens = signalCandles.map((c) => c.open);
  const highs = signalCandles.map((c) => c.high);
  const lows = signalCandles.map((c) => c.low);
  const closes = signalCandles.map((c) => c.close);
  const volumes = signalCandles.map((c) => c.volume);
  const times = signalCandles.map((c) => c.time);

  // 1. RSI
  const rsiArr = rsi(closes, rsiPeriod);

  // 2. Volume Analysis
  const volSmaArr = sma(volumes, volumeSMA_Period);
  const volAvgArr = sma(volumes, length);

  // 3. ADX Calculation
  const { adx: adxArr } = adx(highs, lows, closes, dilen, adxlen);

  // 4. Parabolic SAR
  const { sar: sarArr, isBullish: sarBullishArr } = parabolicSar(highs, lows, sarStart, sarIncrement, sarMaximum, closes);

  // 5. Channels and Support/Resistance
  const highChannel = rollingExtreme(highs, length, 'highest');
  const lowChannel = rollingExtreme(lows, length, 'lowest');
  const YPSAR = rollingExtreme(closes, length, 'highest');
  const DPSAR = rollingExtreme(closes, length, 'lowest');

  const midlevel: number[] = new Array(n);
  const midlevel2: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    midlevel[i] = (highChannel[i] + lowChannel[i]) / 2;
    midlevel2[i] = (YPSAR[i] + DPSAR[i]) / 2;
  }

  const buySignals: { time: number; price: number; reason?: string }[] = [];
  const sellSignals: { time: number; price: number; reason?: string }[] = [];

  // Plots data for Lightweight Charts
  const midLevelPlot: { time: number; value: number }[] = [];
  const midLevel2Plot: { time: number; value: number }[] = [];
  const ypsarPlot: { time: number; value: number }[] = [];
  const dpsarPlot: { time: number; value: number }[] = [];
  const highChannelPlot: { time: number; value: number }[] = [];
  const lowChannelPlot: { time: number; value: number }[] = [];
  const sarPlot: { time: number; value: number }[] = [];

  for (let i = 0; i < n; i++) {
    const t = times[i];
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];

    // populate plot values for chart display
    midLevelPlot.push({ time: t, value: midlevel[i] });
    midLevel2Plot.push({ time: t, value: midlevel2[i] });
    ypsarPlot.push({ time: t, value: YPSAR[i] });
    dpsarPlot.push({ time: t, value: DPSAR[i] });
    highChannelPlot.push({ time: t, value: highChannel[i] });
    lowChannelPlot.push({ time: t, value: lowChannel[i] });
    sarPlot.push({ time: t, value: sarArr[i] });

    // Warmup check: sufficient bars for initial moving average calculation
    const warmup = Math.min(30, Math.max(rsiPeriod, adxlen, Math.floor(n * 0.08)));
    if (i < warmup) continue;

    // RSI condition
    const currentRsi = rsiArr[i];
    const rsiOverbought = currentRsi !== null && currentRsi > rsiOverbought_Level;
    const rsiOversold = currentRsi !== null && currentRsi < rsiOversold_Level;

    // Volume Analysis (volume_avg = ta.sma(volume, length), volume_spike = volume > volume_multiplier * volume_avg)
    const volAvg = volAvgArr[i] ?? v;
    const volume_spike = v > volume_multiplier * volAvg;

    // ADX Calculation (strongTrend = adxValue > Adx_trendThreshold)
    const currentAdx = adxArr[i];
    const strongTrend = currentAdx !== null && currentAdx > Adx_trendThreshold;

    // S/R Touch Detection (touchYPSAR = high > YPSAR and close < YPSAR, touchDPSAR = low < DPSAR and close > DPSAR)
    const touchYPSAR = h > YPSAR[i] && c < YPSAR[i];
    const touchDPSAR = l < DPSAR[i] && c > DPSAR[i];

    // Wick Analysis
    const range = h - l;
    const upper_wick = h - Math.max(o, c);
    const lower_wick = Math.min(o, c) - l;
    const wick_anomaly =
      range > 0 &&
      (upper_wick / range > wick_threshold || lower_wick / range > wick_threshold);

    // Liquidity Trap Detection
    const liquidity_trap = volume_spike && wick_anomaly;

    // Parabolic SAR Filter Conditions
    const sarBullish = c > sarArr[i];
    const sarBearish = c < sarArr[i];

    // BUY/SELL Signals
    const buyCondition =
      liquidity_trap && rsiOversold && strongTrend && touchDPSAR && c > o;
    const sellCondition =
      liquidity_trap && rsiOverbought && strongTrend && touchYPSAR && c < o;

    const isBuy = buyCondition && (!useSARFilter || sarBullish);
    const isSell = sellCondition && (!useSARFilter || sarBearish);

    if (isBuy) {
      buySignals.push({
        time: t,
        price: l * 0.999,
        reason: `RSI: ${currentRsi?.toFixed(1)} | ADX: ${currentAdx?.toFixed(1)} | Liquidity Trap + DPSAR Touch`
      });
    }

    if (isSell) {
      sellSignals.push({
        time: t,
        price: h * 1.001,
        reason: `RSI: ${currentRsi?.toFixed(1)} | ADX: ${currentAdx?.toFixed(1)} | Liquidity Trap + YPSAR Touch`
      });
    }
  }

  return {
    buySignals,
    sellSignals,
    plots: [
      { name: 'Mid Level', color: '#2563eb', linewidth: 1, data: midLevelPlot },
      { name: 'Mid Level 2', color: '#eab308', linewidth: 1, data: midLevel2Plot },
      { name: 'YPSAR', color: '#10b981', linewidth: 2, data: ypsarPlot },
      { name: 'DPSAR', color: '#f97316', linewidth: 2, data: dpsarPlot },
      { name: 'Upper Channel', color: '#a855f7', linewidth: 2, data: highChannelPlot },
      { name: 'Lower Channel', color: '#ef4444', linewidth: 2, data: lowChannelPlot },
      { name: 'Parabolic SAR', color: '#2962FF', style: 'cross', linewidth: 2, data: sarPlot }
    ],
    sarValues: sarArr,
    sarBullish: sarBullishArr,
    adxValues: adxArr,
    rsiValues: rsiArr
  };
}
