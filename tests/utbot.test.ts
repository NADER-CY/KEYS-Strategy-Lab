import assert from 'node:assert/strict';
import { isUtBotAlertsScript, parsePineScriptInputs, validatePineScript } from '../src/engine/defaultPineScripts';
import { calculateUtBotSignals } from '../src/engine/utBotCalculations';
import type { OHLCV } from '../src/types';

const v4 = `//@version=4
study(title="UT Bot Alerts", overlay = true)
a = input(1, title = "Key Vaule")
c = input(10, title = "ATR Period")
h = input(false, title = "Signals from Heikin Ashi Candles")
xATR = atr(c)
xATRTrailingStop = 0.0
xATRTrailingStop := iff(src > 0, 1, 0)
above = crossover(ema, xATRTrailingStop)
below = crossover(xATRTrailingStop, ema)
buy = src > xATRTrailingStop and above
sell = src < xATRTrailingStop and below`;

assert.equal(validatePineScript(v4).valid, true);
assert.equal(validatePineScript(v4).version, 'v4');
assert.equal(isUtBotAlertsScript(v4), true);
assert.deepEqual(parsePineScriptInputs(v4).map((p) => [p.name, p.value]), [['a', 1], ['c', 10], ['h', false]]);

const candles: OHLCV[] = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + Math.sin(i / 5) * 9;
  return { time: 1_700_000_000 + i * 900, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1000 };
});
const output = calculateUtBotSignals(candles, { a: 1, c: 10, h: false });
assert.ok(output.buySignals.length > 0, 'Should find UT Bot buy crossings');
assert.ok(output.sellSignals.length > 0, 'Should find UT Bot sell crossings');
const short = calculateUtBotSignals(candles.slice(0, 40), { a: 1, c: 10, h: false });
assert.deepEqual(short.buySignals, output.buySignals.filter((s) => s.time <= candles[39].time), 'No future-data leakage');
assert.deepEqual(short.sellSignals, output.sellSignals.filter((s) => s.time <= candles[39].time), 'No future-data leakage');
console.log('UT Bot v4 import, parameters, signal crossings and causality: PASS');
