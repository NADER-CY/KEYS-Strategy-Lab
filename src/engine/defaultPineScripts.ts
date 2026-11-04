/**
 * Default Pine Scripts and Pine Script parsing / input extraction
 */
import { IndicatorParam, SavedIndicator } from '../types';

export const ORIGINAL_KEYS_PINE_SCRIPT = `//@version=6
indicator('🔑 KEYS Strategy Lab Liquidity Trap & SAR', overlay = true)

// ─── INPUT SETTINGS ─────────────────────────────────────────────────────
// General Settings
group_general = 'General Settings'
length = input(200, title = 'Period', group = group_general, tooltip = 'Defines the length of the period for calculations.\\n🔹 Higher values smooth out signals but increase lag.\\n🔹 Lower values make signals more responsive but noisier.')

// Wick Analysis
group_wick = 'Wick Analysis'
wick_threshold = input.float(0.6, title = 'Wick Threshold', group = group_wick, tooltip = 'Determines the minimum wick size to be considered significant.\\n🔹 A higher value detects only extreme wick movements.\\n🔹 A lower value includes more candles in the analysis.')

// Volume Analysis
group_volume = 'Volume Analysis'
volumeSMA_Period = input.int(20, title = 'Volume SMA Period', group = group_volume, tooltip = 'Sets the moving average period for volume smoothing.\\n🔹 A higher period smooths out short-term volume fluctuations.\\n🔹 A lower period reacts faster to volume changes.')
volume_multiplier = input.float(1.5, title = 'Volume Multiplier', group = group_volume, tooltip = 'Defines the threshold for detecting volume spikes.\\n🔹 Higher values capture only extreme volume increases.\\n🔹 Lower values make volume spikes more frequent.')

// RSI Settings
group_rsi = 'RSI Settings'
rsiPeriod = input.int(14, title = 'RSI Period', group = group_rsi, tooltip = 'Defines the length of the RSI calculation.\\n🔹 A shorter period makes RSI react faster to price changes.\\n🔹 A longer period smooths out fluctuations.')
rsiOversold_Level = input.int(30, title = 'RSI Oversold Level', group = group_rsi, tooltip = 'RSI level to identify oversold conditions.\\n🔹 A lower value (e.g., 20) makes buy signals rarer but stronger.\\n🔹 A higher value (e.g., 40) increases buy signals but with more noise.')
rsiOverbought_Level = input.int(70, title = 'RSI Overbought Level', group = group_rsi, tooltip = 'RSI level to identify overbought conditions.\\n🔹 A lower value (e.g., 60) makes sell signals more frequent but less reliable.\\n🔹 A higher value (e.g., 80) reduces false sell signals but may miss early reversals.')

// ADX Settings
group_adx = 'ADX Settings'
adxlen = input(14, title = 'ADX Smoothing', group = group_adx, tooltip = 'Determines the smoothing length for ADX calculations.\\n🔹 A higher value smooths trends but may lag.\\n🔹 A lower value makes trend detection faster but noisier.')
dilen = input(14, title = 'DI Length', group = group_adx, tooltip = 'Defines the length for Directional Index (DI) calculation.\\n🔹 A higher value smooths DI calculations but may react slower.\\n🔹 A lower value reacts quickly to trend shifts.')
Adx_trendThreshold = input(30, title = 'Trend Strength Threshold', group = group_adx, tooltip = 'Defines the minimum ADX level to confirm a strong trend.\\n🔹 Higher values filter out weak trends but may reduce signals.\\n🔹 Lower values allow more signals but may include false trends.')

// ─── SAR Filter Settings ────────────────────────────────────────────────
group_sar = 'Parabolic SAR Filter'
useSARFilter = input.bool(true, title = 'Enable SAR Filter', group = group_sar, tooltip = 'When enabled, signals are confirmed only in SAR direction.')
sarStart = input.float(0.02, title = 'SAR Start', group = group_sar)
sarIncrement = input.float(0.02, title = 'SAR Increment', group = group_sar)
sarMaximum = input.float(0.2, title = 'SAR Max Value', group = group_sar)

// ─── INDICATOR CALCULATIONS ─────────────────────────────────────────────
// RSI Calculation
rsi = ta.rsi(close, rsiPeriod)
rsiOverbought = rsi > rsiOverbought_Level
rsiOversold = rsi < rsiOversold_Level

// Volume Analysis
volumeSma = ta.sma(volume, volumeSMA_Period)
volume_avg = ta.sma(volume, length)
volume_spike = volume > volume_multiplier * volume_avg

// ADX Calculation
dirmov(len) =>
    up = ta.change(high)
    down = -ta.change(low)
    plusDM = na(up) ? na : up > down and up > 0 ? up : 0
    minusDM = na(down) ? na : down > up and down > 0 ? down : 0
    truerange = ta.rma(ta.tr, len)
    plus = fixnan(100 * ta.rma(plusDM, len) / truerange)
    minus = fixnan(100 * ta.rma(minusDM, len) / truerange)
    [plus, minus]

adx(dilen, adxlen) =>
    [plus, minus] = dirmov(dilen)
    sum = plus + minus
    adx = 100 * ta.rma(math.abs(plus - minus) / (sum == 0 ? 1 : sum), adxlen)
    adx

adxValue = adx(dilen, adxlen)
strongTrend = adxValue > Adx_trendThreshold

// ─── CHANNEL & SUPPORT/RESISTANCE LEVELS ────────────────────────────────
highChannel = ta.highest(high, length)
lowChannel = ta.lowest(low, length)
midlevel = (highChannel + lowChannel) / 2
YPSAR = ta.highest(close, length)
DPSAR = ta.lowest(close, length)
midlevel2 = (YPSAR + DPSAR) / 2

// Touch Detection
touchYPSAR = high > YPSAR and close < YPSAR
touchDPSAR = low < DPSAR and close > DPSAR

// ─── WICK ANALYSIS ───────────────────────────────────────────────────────
upper_wick = high - math.max(open, close)
lower_wick = math.min(open, close) - low
wick_anomaly = upper_wick / (high - low) > wick_threshold or lower_wick / (high - low) > wick_threshold

// ─── LIQUIDITY TRAP DETECTION ────────────────────────────────────────────
liquidity_trap = volume_spike and wick_anomaly

// ─── PARABOLIC SAR ───────────────────────────────────────────────────────
sar = ta.sar(sarStart, sarIncrement, sarMaximum)
sarBullish = close > sar
sarBearish = close < sar

// ─── BUY/SELL SIGNALS ────────────────────────────────────────────────────
buyCondition = liquidity_trap and rsiOversold and strongTrend and touchDPSAR and close > open
sellCondition = liquidity_trap and rsiOverbought and strongTrend and touchYPSAR and close < open

buySignal = buyCondition and (not useSARFilter or sarBullish)
sellSignal = sellCondition and (not useSARFilter or sarBearish)

// ─── VISUALIZATION ───────────────────────────────────────────────────────
plot(midlevel, title = 'Mid Level', color = color.blue, linewidth = 1)
plot(midlevel2, title = 'Mid Level 2', color = color.yellow, linewidth = 1)
plot(YPSAR, color = color.green, linewidth = 2, title = 'YPSAR')
plot(DPSAR, color = color.orange, linewidth = 2, title = 'DPSAR')
plot(highChannel, color = color.purple, linewidth = 3, title = 'Upper Channel')
plot(lowChannel, color = color.red, linewidth = 3, title = 'Lower Channel')
plot(sar, title = "Parabolic SAR", style = plot.style_cross, color = #2962FF, linewidth = 2)

plotshape(buySignal, location = location.belowbar, color = color.green, style = shape.labelup, text = 'BUY', size = size.small)
plotshape(sellSignal, location = location.abovebar, color = color.red, style = shape.labeldown, text = 'SELL', size = size.small)
`;

export const SAVED_INDICATORS_DEFAULT: SavedIndicator[] = [
  {
    id: 'keys_v6',
    name: 'KEYS Liquidity Trap & SAR',
    version: 'v6',
    type: 'Indicator',
    lastUpdated: '2026-11-02 10:45',
    validationStatus: 'Validated',
    chartStatus: 'Active on Chart',
    code: ORIGINAL_KEYS_PINE_SCRIPT,
    params: [
      { id: 'length', name: 'length', title: 'Period', type: 'int', default: 200, value: 200, min: 10, max: 500, group: 'General Settings', tooltip: 'Defines calculation period for channel and SAR.' },
      { id: 'wick_threshold', name: 'wick_threshold', title: 'Wick Threshold', type: 'float', default: 0.6, value: 0.6, min: 0.1, max: 0.95, step: 0.05, group: 'Wick Analysis', tooltip: 'Minimum wick ratio to candle range.' },
      { id: 'volumeSMA_Period', name: 'volumeSMA_Period', title: 'Volume SMA Period', type: 'int', default: 20, value: 20, min: 5, max: 100, group: 'Volume Analysis' },
      { id: 'volume_multiplier', name: 'volume_multiplier', title: 'Volume Multiplier', type: 'float', default: 1.5, value: 1.5, min: 1.0, max: 5.0, step: 0.1, group: 'Volume Analysis' },
      { id: 'rsiPeriod', name: 'rsiPeriod', title: 'RSI Period', type: 'int', default: 14, value: 14, min: 2, max: 50, group: 'RSI Settings' },
      { id: 'rsiOversold_Level', name: 'rsiOversold_Level', title: 'RSI Oversold Level', type: 'int', default: 30, value: 30, min: 10, max: 45, group: 'RSI Settings' },
      { id: 'rsiOverbought_Level', name: 'rsiOverbought_Level', title: 'RSI Overbought Level', type: 'int', default: 70, value: 70, min: 55, max: 90, group: 'RSI Settings' },
      { id: 'adxlen', name: 'adxlen', title: 'ADX Smoothing', type: 'int', default: 14, value: 14, min: 5, max: 50, group: 'ADX Settings' },
      { id: 'dilen', name: 'dilen', title: 'DI Length', type: 'int', default: 14, value: 14, min: 5, max: 50, group: 'ADX Settings' },
      { id: 'Adx_trendThreshold', name: 'Adx_trendThreshold', title: 'Trend Strength Threshold', type: 'int', default: 30, value: 30, min: 10, max: 60, group: 'ADX Settings' },
      { id: 'useSARFilter', name: 'useSARFilter', title: 'Enable SAR Filter', type: 'bool', default: true, value: true, group: 'Parabolic SAR Filter' },
      { id: 'sarStart', name: 'sarStart', title: 'SAR Start', type: 'float', default: 0.02, value: 0.02, min: 0.005, max: 0.1, step: 0.005, group: 'Parabolic SAR Filter' },
      { id: 'sarIncrement', name: 'sarIncrement', title: 'SAR Increment', type: 'float', default: 0.02, value: 0.02, min: 0.005, max: 0.1, step: 0.005, group: 'Parabolic SAR Filter' },
      { id: 'sarMaximum', name: 'sarMaximum', title: 'SAR Max Value', type: 'float', default: 0.2, value: 0.2, min: 0.05, max: 0.5, step: 0.05, group: 'Parabolic SAR Filter' }
    ]
  },
  {
    id: 'keys_v1',
    name: 'KEYS v1 Trend & Momentum',
    version: 'v5',
    type: 'Strategy',
    lastUpdated: '2026-11-01 18:20',
    validationStatus: 'Backtest Ready',
    chartStatus: 'Chart Ready',
    code: `//@version=5
indicator("KEYS v1 Trend & Momentum", overlay=true)
emaFast = ta.ema(close, input.int(9, title="Fast EMA"))
emaSlow = ta.ema(close, input.int(21, title="Slow EMA"))
rsi = ta.rsi(close, input.int(14, title="RSI"))
buySignal = ta.crossover(emaFast, emaSlow) and rsi < 65
sellSignal = ta.crossunder(emaFast, emaSlow) and rsi > 35
plot(emaFast, color=color.green, title="EMA Fast")
plot(emaSlow, color=color.red, title="EMA Slow")
plotshape(buySignal, style=shape.labelup, color=color.green, text="BUY", location=location.belowbar)
plotshape(sellSignal, style=shape.labeldown, color=color.red, text="SELL", location=location.abovebar)
`,
    params: [
      { id: 'fastEma', name: 'fastEma', title: 'Fast EMA', type: 'int', default: 9, value: 9, min: 3, max: 50 },
      { id: 'slowEma', name: 'slowEma', title: 'Slow EMA', type: 'int', default: 21, value: 21, min: 10, max: 100 },
      { id: 'rsiLength', name: 'rsiLength', title: 'RSI Length', type: 'int', default: 14, value: 14, min: 5, max: 50 }
    ]
  },
  {
    id: 'vwap_bands',
    name: 'Dynamic VWAP Bands',
    version: 'v5',
    type: 'Indicator',
    lastUpdated: '2026-10-28 14:10',
    validationStatus: 'Saved',
    chartStatus: 'Not on Chart',
    code: `//@version=5
indicator("Dynamic VWAP Bands", overlay=true)
length = input.int(20, title="Length")
mult = input.float(2.0, title="StdDev Multiplier")
basis = ta.sma(close, length)
dev = mult * ta.stdev(close, length)
upper = basis + dev
lower = basis - dev
buySignal = ta.crossover(close, lower)
sellSignal = ta.crossunder(close, upper)
plot(basis, color=color.blue, title="Basis")
plot(upper, color=color.red, title="Upper")
plot(lower, color=color.green, title="Lower")
`,
    params: [
      { id: 'length', name: 'length', title: 'Length', type: 'int', default: 20, value: 20, min: 5, max: 100 },
      { id: 'mult', name: 'mult', title: 'StdDev Multiplier', type: 'float', default: 2.0, value: 2.0, min: 0.5, max: 5.0, step: 0.1 }
    ]
  }
];

/**
 * Parses Pine Script code and extracts input parameters
 */
export function parsePineScriptInputs(script: string): IndicatorParam[] {
  const params: IndicatorParam[] = [];
  const lines = script.split('\n');

  // Regex patterns for input variations:
  // e.g. length = input(200, title = 'Period', group = group_general, tooltip = '...')
  // e.g. wick_threshold = input.float(0.6, title = 'Wick Threshold', ...)
  // e.g. useSARFilter = input.bool(true, title = 'Enable SAR Filter', ...)
  // e.g. rsiPeriod = input.int(14, title = 'RSI Period', ...)
  const inputRegex = /([a-zA-Z0-9_]+)\s*=\s*input(?:\.(int|float|bool|string))?\s*\(([^)]+)\)/g;

  for (const line of lines) {
    if (line.trim().startsWith('//')) continue;
    let match: RegExpExecArray | null;

    while ((match = inputRegex.exec(line)) !== null) {
      const varName = match[1];
      const explicitType = match[2];
      const argsStr = match[3];

      // Parse arguments
      // e.g. 200, title = 'Period', group = group_general
      const titleMatch = /title\s*=\s*['"]([^'"]+)['"]/.exec(argsStr);
      const title = titleMatch ? titleMatch[1] : varName;

      const groupMatch = /group\s*=\s*(?:'([^']+)'|"([^"]+)"|([a-zA-Z0-9_]+))/.exec(argsStr);
      const group = groupMatch ? (groupMatch[1] || groupMatch[2] || groupMatch[3]) : undefined;

      const tooltipMatch = /tooltip\s*=\s*['"]([^'"]+)['"]/.exec(argsStr);
      const tooltip = tooltipMatch ? tooltipMatch[1] : undefined;

      // First positional argument is usually the default value
      const firstArg = argsStr.split(',')[0].trim();
      let defaultValue: number | boolean | string = 0;
      let paramType: 'int' | 'float' | 'bool' | 'string' = explicitType as any || 'float';

      if (firstArg === 'true' || firstArg === 'false') {
        defaultValue = firstArg === 'true';
        paramType = 'bool';
      } else if (!isNaN(Number(firstArg))) {
        const num = Number(firstArg);
        if (Number.isInteger(num) && (!explicitType || explicitType === 'int')) {
          paramType = 'int';
          defaultValue = num;
        } else {
          paramType = 'float';
          defaultValue = num;
        }
      } else if (firstArg.startsWith("'") || firstArg.startsWith('"')) {
        defaultValue = firstArg.replace(/['"]/g, '');
        paramType = 'string';
      }

      params.push({
        id: varName,
        name: varName,
        title,
        type: paramType,
        default: defaultValue,
        value: defaultValue,
        group,
        tooltip,
        min: paramType === 'int' ? Math.max(1, Math.floor(Number(defaultValue) * 0.2)) : undefined,
        max: paramType === 'int' ? Math.floor(Number(defaultValue) * 3) : undefined,
        step: paramType === 'float' ? 0.05 : 1
      });
    }
  }

  // If no params parsed via regex (e.g. specialized syntax), return keys default params
  if (params.length === 0) {
    return SAVED_INDICATORS_DEFAULT[0].params;
  }

  return params;
}

/**
 * Validates a Pine script code string
 */
export function validatePineScript(code: string): { valid: boolean; version: string; error?: string; inputsCount: number } {
  if (!code || code.trim().length === 0) {
    return { valid: false, version: 'v6', error: 'Script code cannot be empty.', inputsCount: 0 };
  }

  const versionMatch = /\/\/@version=(\d+)/.exec(code);
  const version = versionMatch ? `v${versionMatch[1]}` : 'v6';

  const hasIndicatorOrStrategy = /indicator\s*\(|strategy\s*\(/.test(code);
  if (!hasIndicatorOrStrategy) {
    return {
      valid: false,
      version,
      error: 'Pine Script must declare either indicator() or strategy() declaration.',
      inputsCount: 0
    };
  }

  const inputs = parsePineScriptInputs(code);
  return {
    valid: true,
    version,
    inputsCount: inputs.length
  };
}
