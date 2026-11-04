/**
 * Regression tests for defects fixed in the November 2026 audit.
 *
 * These tests drive the REAL BacktestService / storage / exchange code paths.
 * Only the network boundary is replaced with deterministic fixtures, so no
 * exchange is contacted and no order can ever be sent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Storage writes to <cwd>/data and caches to <cwd>/.cache, so isolate them
// BEFORE the modules (which create their singletons on import) are loaded.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-regression-'));
process.chdir(workDir);

const { storageService } = await import('../server/storage');
const { exchangeService, ExchangeDataService, mergeTail, lowerBound } = await import('../server/exchanges');
const { BacktestService } = await import('../server/backtestService');
const { calculateUtBotSignals } = await import('../src/engine/utBotCalculations');
const { calculateKeysIndicator, toHeikinAshiCandles, adx, rma } = await import('../src/engine/indicatorCalculations');
const { validatePnLConfig } = await import('../src/engine/pnlRules');
const { mergeRecentCandles, mergeOlderCandles } = await import('../src/engine/candleMerge');
const { ORIGINAL_KEYS_PINE_SCRIPT, SAVED_INDICATORS_DEFAULT } = await import('../src/engine/defaultPineScripts');
const { calculateExecutedExitPrice } = await import('../src/engine/executionPrice');
type OHLCV = import('../src/types').OHLCV;
type PortfolioConfig = import('../src/types').PortfolioConfig;
type PnLConfig = import('../src/types').PnLConfig;
type BacktestRun = import('../src/types').BacktestRun;

let passed = 0;
let failed = 0;
const results: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ PASS  ${name}`);
  } catch (error: any) {
    failed++;
    results.push(`  ✗ FAIL  ${name}\n          ${String(error?.stack || error).split('\n').slice(0, 4).join('\n          ')}`);
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
const STEP = 300; // 5m
const NOW = Math.floor(Date.now() / 1000);
const LAST_CLOSED = Math.floor(NOW / STEP) * STEP - STEP; // last fully closed 5m bar

/** Build closed candles from a close-price path, plus one still-forming bar. */
function candlesFromPath(closes: number[]): OHLCV[] {
  const first = LAST_CLOSED - (closes.length - 1) * STEP;
  const out: OHLCV[] = [];
  for (let i = 0; i < closes.length; i++) {
    const open = i === 0 ? closes[0] : closes[i - 1];
    const close = closes[i];
    out.push({ time: first + i * STEP, open, high: Math.max(open, close) + 0.05, low: Math.min(open, close) - 0.05, close, volume: 1000 });
  }
  // Still-forming bar with a wild price: must never be used by a backtest.
  out.push({ time: LAST_CLOSED + STEP, open: closes[closes.length - 1], high: 1e6, low: 0.0001, close: 1e5, volume: 1 });
  return out;
}
function pathOf(length: number, segments: [fromBar: number, price: number][]): number[] {
  const closes: number[] = new Array(length);
  let price = segments[0][1];
  let seg = 0;
  for (let i = 0; i < length; i++) {
    while (seg + 1 < segments.length && segments[seg + 1][0] <= i) price = segments[++seg][1];
    closes[i] = price;
  }
  return closes;
}

const UT_BOT_V4 = `//@version=4
study(title="UT Bot Alerts", overlay = true)
a = input(1,     title = "Key Vaule. 'This changes the sensitivity'")
c = input(10,    title = "ATR Period")
h = input(false, title = "Signals from Heikin Ashi Candles")
xATR  = atr(c)
nLoss = a * xATR
src = h ? security(heikinashi(syminfo.tickerid), timeframe.period, close, lookahead = false) : close
xATRTrailingStop = 0.0
xATRTrailingStop := iff(src > nz(xATRTrailingStop[1], 0) and src[1] > nz(xATRTrailingStop[1], 0), max(nz(xATRTrailingStop[1]), src - nLoss),
   iff(src < nz(xATRTrailingStop[1], 0) and src[1] < nz(xATRTrailingStop[1], 0), min(nz(xATRTrailingStop[1]), src + nLoss),
   iff(src > nz(xATRTrailingStop[1], 0), src - nLoss, src + nLoss)))
pos = 0
pos :=	iff(src[1] < nz(xATRTrailingStop[1], 0) and src > nz(xATRTrailingStop[1], 0), 1,
   iff(src[1] > nz(xATRTrailingStop[1], 0) and src < nz(xATRTrailingStop[1], 0), -1, nz(pos[1], 0)))
ema   = ema(src,1)
above = crossover(ema, xATRTrailingStop)
below = crossover(xATRTrailingStop, ema)
buy  = src > xATRTrailingStop and above
sell = src < xATRTrailingStop and below
plotshape(buy,  title = "Buy",  text = 'Buy',  style = shape.labelup,   location = location.belowbar, color= color.green, textcolor = color.white, size = size.tiny)
plotshape(sell, title = "Sell", text = 'Sell', style = shape.labeldown, location = location.abovebar, color= color.red,   textcolor = color.white, size = size.tiny)`;

storageService.saveIndicator({
  id: 'ut_test', name: 'UT Bot Test', version: 'v4', type: 'Indicator', lastUpdated: '', validationStatus: 'Backtest Ready',
  chartStatus: 'Chart Ready', code: UT_BOT_V4,
  params: [
    { id: 'a', name: 'a', title: 'Key', type: 'float', default: 1, value: 1 },
    { id: 'c', name: 'c', title: 'ATR', type: 'int', default: 3, value: 3 },
    { id: 'h', name: 'h', title: 'HA', type: 'bool', default: false, value: false }
  ]
});

const market = new Map<string, OHLCV[]>();
const leverage = new Map<string, number>();
let funding = new Map<string, { time: number; rate: number }[]>();
const service = exchangeService as any;
service.getOHLCVCandles = async (_ex: string, symbol: string, _tf: number, count: number) => {
  const data = market.get(symbol);
  if (!data) throw new Error(`no fixture for ${symbol}`);
  return data.slice(-count);
};
service.getContractMeta = async (_ex: string, symbol: string) =>
  leverage.has(symbol) ? { symbol, maxLeverage: leverage.get(symbol) } : undefined;
service.getBybitFundingHistory = async (symbol: string, from: number, to: number) =>
  (funding.get(symbol) || []).filter((e) => e.time >= from && e.time <= to);

const PNL: PnLConfig = {
  rules: [
    { fromPct: 50, toPct: 80, dropPct: 30 },
    { fromPct: 81, toPct: 120, dropPct: 30 },
    { fromPct: 121, toPct: 150, dropPct: 30 },
    { fromPct: 151, toPct: 200, dropPct: 30 },
    { fromPct: 201, toPct: 500, dropPct: 30 }
  ],
  fixedFloorEnabled: false, fixedFloorTriggerPct: 50, fixedFloorLockPct: 30
};
const baseConfig = (overrides: Partial<PortfolioConfig> = {}): PortfolioConfig => ({
  exchange: 'bybit', savedGroupId: 'g', initialCapital: 300, positionSizeNotional: 10, useMaxLeverage: false,
  manualLeverage: 50, marginMode: 'cross', maxOpenPositions: 10, cycleFromDay: 1, cycleToDay: 1, backtestTimeframe: 5,
  testPeriodDays: 30, maxDrawdownCutoff: 0, slippageTolerance: 0.05, feeTakerPct: 0.055, feeMakerPct: 0.02,
  fundingRate8hPct: 0.01, ...overrides
});
const UT_PARAMS = { a: 1, c: 3, h: false, candleType: 'regular' };
const BARS_30D = 30 * 288;

async function runAndWait(bt: InstanceType<typeof BacktestService>, groupSymbols: string[], config: PortfolioConfig, params: Record<string, any> = UT_PARAMS, indicatorId = 'ut_test') {
  const groupId = `g_${Math.random().toString(36).slice(2)}`;
  storageService.saveGroup({ id: groupId, name: groupId, exchange: config.exchange, symbols: groupSymbols, createdAt: '', updatedAt: '' });
  const id = await bt.runBacktest({ ...config, savedGroupId: groupId }, PNL, params, 'test', indicatorId);
  const deadline = Date.now() + 60_000;
  while (bt.getActiveJob(id)?.run.status === 'RUNNING') {
    if (Date.now() > deadline) throw new Error('backtest timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
  return bt.getActiveJob(id)!.run;
}

/** Independent check: cash and equity reconcile with the trade ledger. */
function assertLedgerReconciles(run: BacktestRun, initial: number) {
  const closed = run.trades.filter((t) => t.status === 'CLOSED');
  const open = run.trades.filter((t) => t.status === 'OPEN');
  const cash = initial + closed.reduce((s, t) => s + t.pnlUsdt, 0) - open.reduce((s, t) => s + t.feePaid + t.fundingPaid, 0);
  assert.ok(Math.abs(cash - run.cashBalance!) < 0.01, `cash ${cash} != reported ${run.cashBalance}`);
  const equity = cash + open.reduce((s, t) => s + t.pnlUsdt, 0);
  assert.ok(Math.abs(equity - run.finalBalance) < 0.01, `equity ${equity} != reported ${run.finalBalance}`);
  const fees = run.trades.reduce((s, t) => s + t.feePaid, 0);
  assert.ok(Math.abs(fees - run.totalFeesPaid!) < 1e-4, 'fee total mismatch');
  const fundingTotal = run.trades.reduce((s, t) => s + t.fundingPaid, 0);
  assert.ok(Math.abs(fundingTotal - run.totalFundingPaid!) < 1e-4, 'funding total mismatch');
}

// ─── Backtest engine ────────────────────────────────────────────────────────
await test('Cycle expiry while losing: hold, freeze entries, close only at breakeven (no forced close)', async () => {
  // A: flat 100 → drop to 99 (UT Bot SELL at bar 100, short at bar 101) →
  //    rises to 101 (short loses) past 1-day expiry → falls to 97 (recovers).
  market.set('AUSDT', candlesFromPath(pathOf(BARS_30D, [[0, 100], [100, 99], [130, 101], [700, 97]])));
  // B: signals SELL at bar 500, inside the frozen window → must NOT enter.
  market.set('BUSDT', candlesFromPath(pathOf(BARS_30D, [[0, 50], [500, 49]])));
  leverage.set('AUSDT', 100); leverage.set('BUSDT', 100);
  funding = new Map();
  const run = await runAndWait(new BacktestService(), ['AUSDT', 'BUSDT'], baseConfig());
  assert.equal(run.status, 'COMPLETED', run.error);
  const a = market.get('AUSDT')!;
  const first = run.trades.find((t) => t.symbol === 'AUSDT')!;
  assert.equal(first.side, 'SELL');
  assert.equal(first.entryTime, a[101].time, 'entry must be the bar after the signal (N+1 open)');
  const expiry = first.entryTime + 86400;
  assert.ok(run.logs.some((l) => l.includes('Holding positions and freezing new entries')), 'freeze must be logged');
  assert.equal(first.exitReason, 'CYCLE_EXPIRY');
  assert.ok(first.exitTime! >= a[700].time, `losing basket was force-closed at ${first.exitTime} before recovery bar ${a[700].time}`);
  assert.ok(first.exitTime! > expiry, 'position must be held past the expiry day');
  const bEntries = run.trades.filter((t) => t.symbol === 'BUSDT' && t.entryTime > expiry && t.entryTime <= first.exitTime!);
  assert.equal(bEntries.length, 0, 'no new entries while the expired cycle waits for breakeven');
  assert.equal(run.cycles[0].exitReason, 'CYCLE_EXPIRY');
  assert.ok(run.cycles[0].realizedPnl > -0.05, 'closed at (near) breakeven, not at the loss');
  assertLedgerReconciles(run, 300);
});

await test('Profitable cycle at expiry closes exactly at the expiry bar', async () => {
  market.set('CUSDT', candlesFromPath(pathOf(BARS_30D, [[0, 100], [100, 99], [140, 98]])));
  leverage.set('CUSDT', 100);
  const run = await runAndWait(new BacktestService(), ['CUSDT'], baseConfig());
  const c = market.get('CUSDT')!;
  const trade = run.trades[0];
  assert.equal(trade.exitReason, 'CYCLE_EXPIRY');
  assert.equal(trade.exitTime, trade.entryTime + 86400, 'profitable basket closes on the expiry bar');
  // Exit is a market order at the bar close with adverse slippage; the exit
  // fee is charged on the exit order value.
  const close = c.find((x) => x.time === trade.exitTime)!.close;
  assert.ok(Math.abs(trade.exitPrice! - calculateExecutedExitPrice(close, 'SELL', 0.05)) < 1e-12, 'exit slippage');
  const entryFee = 10 * 0.00055;
  const exitFee = 10 * (trade.exitPrice! / trade.entryPrice) * 0.00055;
  assert.ok(Math.abs(trade.feePaid - (entryFee + exitFee)) < 1e-9, 'entry + exit taker fees');
  const gross = 10 * (trade.entryPrice - trade.exitPrice!) / trade.entryPrice;
  assert.ok(Math.abs(trade.pnlUsdt - (gross - entryFee - exitFee - trade.fundingPaid)) < 1e-4, 'realised PnL is net of all costs');
  assertLedgerReconciles(run, 300);
});

await test('Historical Bybit funding: shorts receive positive rates, sign and mark notional are exact', async () => {
  const c = market.get('CUSDT')!;
  const events = [];
  for (let t = Math.ceil(c[0].time / 28800) * 28800; t < c[c.length - 1].time; t += 28800) events.push({ time: t, rate: 0.0001 });
  funding = new Map([['CUSDT', events]]);
  const run = await runAndWait(new BacktestService(), ['CUSDT'], baseConfig());
  const trade = run.trades[0];
  let expected = 0;
  for (const e of events) {
    if (e.time <= trade.entryTime || e.time > trade.exitTime!) continue;
    const barTime = Math.ceil(e.time / STEP) * STEP; // applied on the bar that opens at/after settlement
    const prior = c.find((x) => x.time === barTime - STEP)!.close;
    expected += -(10 * prior / trade.entryPrice) * e.rate;
  }
  assert.ok(expected < 0, 'fixture must include settlements');
  assert.ok(Math.abs(trade.fundingPaid - expected) < 1e-12, `funding ${trade.fundingPaid} != ${expected}`);
  assert.ok(run.logs.some((l) => l.includes('[COSTS]')), 'cost summary logged');
  assertLedgerReconciles(run, 300);
  funding = new Map();
});

await test('Cross margin: entries require FREE margin (balance + uPnL − used margin)', async () => {
  market.set('DUSDT', candlesFromPath(pathOf(BARS_30D, [[0, 100], [100, 99]])));
  market.set('EUSDT', candlesFromPath(pathOf(BARS_30D, [[0, 100], [100, 99]])));
  leverage.set('DUSDT', 100); leverage.set('EUSDT', 100);
  // $0.25 covers ONE $0.20 margin + fee. The old check (balance >= margin)
  // admitted the second position on the same, already-used collateral.
  const run = await runAndWait(new BacktestService(), ['DUSDT', 'EUSDT'], baseConfig({ initialCapital: 0.25 }));
  const firstBarEntries = run.trades.filter((t) => t.entryTime === market.get('DUSDT')![101].time);
  assert.equal(firstBarEntries.length, 1, `expected 1 admitted entry, got ${firstBarEntries.length}`);
  assert.ok(run.logs.some((l) => l.includes('free cross margin')), 'rejection is logged');
});

await test('Maximum open positions is enforced', async () => {
  const run = await runAndWait(new BacktestService(), ['DUSDT', 'EUSDT'], baseConfig({ maxOpenPositions: 1 }));
  const maxConcurrent = Math.max(...run.equityCurve.map((p) => p.openPositionsCount));
  assert.equal(maxConcurrent, 1);
});

await test('Actual contract leverage: max-leverage mode uses the exchange limit, unknown limits fail', async () => {
  leverage.set('DUSDT', 25);
  const run = await runAndWait(new BacktestService(), ['DUSDT'], baseConfig({ useMaxLeverage: true }));
  assert.equal(run.trades[0].leverage, 25);
  assert.ok(Math.abs(run.trades[0].margin - 0.4) < 1e-9, 'initial margin = notional / leverage');
  leverage.delete('DUSDT');
  const unknown = await runAndWait(new BacktestService(), ['DUSDT'], baseConfig({ useMaxLeverage: true }));
  assert.equal(unknown.status, 'FAILED');
  assert.match(unknown.error || '', /not published/);
  leverage.set('DUSDT', 25);
  const tooHigh = await runAndWait(new BacktestService(), ['DUSDT'], baseConfig({ manualLeverage: 50 }));
  assert.equal(tooHigh.status, 'FAILED');
  assert.match(tooHigh.error || '', /exceeds maximum contract leverage of 25x/);
  leverage.set('DUSDT', 100);
});

await test('Still-forming candle is excluded from signals, marks and the timeline', async () => {
  const run = await runAndWait(new BacktestService(), ['CUSDT'], baseConfig());
  const lastPoint = run.equityCurve[run.equityCurve.length - 1];
  assert.equal(lastPoint.time, LAST_CLOSED);
  assert.ok(run.finalBalance < 1000, 'the fixture forming bar (close 1e5) must not be marked');
});

await test('Stop request mid-simulation is honoured and saved as STOPPED (not COMPLETED)', async () => {
  const bars = 365 * 288;
  for (const s of ['S1USDT', 'S2USDT', 'S3USDT']) {
    market.set(s, candlesFromPath(Array.from({ length: bars }, (_, i) => 100 + Math.sin(i / 37) * 3)));
    leverage.set(s, 100);
  }
  const bt = new BacktestService();
  const groupId = 'stop_group';
  storageService.saveGroup({ id: groupId, name: groupId, exchange: 'bybit', symbols: ['S1USDT', 'S2USDT', 'S3USDT'], createdAt: '', updatedAt: '' });
  const id = await bt.runBacktest(baseConfig({ savedGroupId: groupId, testPeriodDays: 365 }), PNL, UT_PARAMS, 't', 'ut_test');
  // Wait until the time loop has started, then stop.
  while ((bt.getActiveJob(id)?.progress ?? 0) < 26) await new Promise((r) => setTimeout(r, 1));
  assert.equal(bt.stopJob(id), true);
  while (bt.getActiveJob(id)!.progress < 100 && bt.getActiveJob(id)!.run.logs.every((l) => !l.includes('STOPPED by user'))) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const run = storageService.getBacktestRunById(id)!;
  assert.equal(run.status, 'STOPPED');
  assert.ok(run.logs.some((l) => l.includes('partial window')), 'partial results are labelled');
  for (const s of ['S1USDT', 'S2USDT', 'S3USDT']) market.delete(s);
});

await test('Run ids never overwrite an existing saved backtest', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5; // every random id collides
  try {
    const bt = new BacktestService();
    const r1 = await runAndWait(bt, ['CUSDT'], baseConfig());
    const r2 = await runAndWait(bt, ['CUSDT'], baseConfig());
    assert.notEqual(r1.id, r2.id);
    assert.ok(storageService.getBacktestRunById(r1.id) && storageService.getBacktestRunById(r2.id), 'both runs persisted');
  } finally {
    Math.random = originalRandom;
  }
});

await test('Renko signals use the BACKTEST timeframe, not the chart timeframe', async () => {
  const run = await runAndWait(new BacktestService(), ['CUSDT'], baseConfig(), { ...UT_PARAMS, candleType: 'renko', renkoTimeframeMinutes: 60 });
  assert.equal(run.indicatorParams.renkoTimeframeMinutes, 5);
  assert.equal(run.status, 'COMPLETED', run.error);
});

await test('Isolated margin is rejected instead of being silently simulated as cross', async () => {
  await assert.rejects(new BacktestService().runBacktest(baseConfig({ marginMode: 'isolated' }), PNL, UT_PARAMS, 't', 'ut_test'), /cross-margin/);
});

await test('Unsupported Pine scripts never execute another indicator\'s logic', async () => {
  storageService.saveIndicator({ ...SAVED_INDICATORS_DEFAULT[2], id: 'vwap_test', name: 'VWAP test' });
  const groupId = 'unsupported_group';
  storageService.saveGroup({ id: groupId, name: groupId, exchange: 'bybit', symbols: ['CUSDT'], createdAt: '', updatedAt: '' });
  await assert.rejects(new BacktestService().runBacktest(baseConfig({ savedGroupId: groupId }), PNL, {}, 't', 'vwap_test'), /verified executable backtest adapter/);
});

await test('Sharpe ratio is an annualised return/volatility statistic, not ROI/drawdown', async () => {
  const run = await runAndWait(new BacktestService(), ['AUSDT', 'BUSDT'], baseConfig());
  assert.ok(Number.isFinite(run.sharpeRatio));
  const legacy = Number((run.roiPct / (Math.max(1, run.maxDrawdownPct) * 1.5)).toFixed(2));
  assert.ok(run.sharpeRatio !== legacy || run.sharpeRatio === 0);
});

// ─── Indicators ─────────────────────────────────────────────────────────────
/** Independent, literal transcription of the UT Bot v4 Pine script. */
function referenceUtBot(candles: OHLCV[], a: number, c: number, h: boolean) {
  const n = candles.length;
  const src = h ? toHeikinAshiCandles(candles).map((x) => x.close) : candles.map((x) => x.close);
  const tr = candles.map((x, i) => i === 0 ? x.high - x.low
    : Math.max(x.high - x.low, Math.abs(x.high - candles[i - 1].close), Math.abs(x.low - candles[i - 1].close)));
  const atr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i === c - 1) atr[i] = tr.slice(0, c).reduce((s, v) => s + v, 0) / c;
    else if (i >= c) atr[i] = (tr[i] + (c - 1) * atr[i - 1]!) / c;
  }
  const stop: (number | null)[] = new Array(n).fill(null);
  const nz = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? 0 : v);
  const buys: number[] = [];
  const sells: number[] = [];
  for (let i = 0; i < n; i++) {
    if (atr[i] === null) continue; // nLoss is na → stop is na
    const loss = a * atr[i]!;
    const prev = nz(stop[i - 1]);
    const s1 = i > 0 ? src[i - 1] : NaN;
    stop[i] = src[i] > prev && s1 > prev ? Math.max(prev, src[i] - loss)
      : src[i] < prev && s1 < prev ? Math.min(prev, src[i] + loss)
        : src[i] > prev ? src[i] - loss : src[i] + loss;
    if (i === 0 || stop[i - 1] === null) continue; // crossover against na is false
    if (src[i] > stop[i]! && src[i] > stop[i]! && src[i - 1] <= stop[i - 1]!) buys.push(candles[i].time);
    if (src[i] < stop[i]! && stop[i]! > src[i] && stop[i - 1]! <= src[i - 1]) sells.push(candles[i].time);
  }
  return { buys, sells };
}

await test('UT Bot ATR trailing stop, crossovers and Heikin Ashi source match a literal Pine transcription', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [a, c, h] of [[1, 10, false], [2, 5, false], [0.5, 14, true], [1, 1, true], [3, 30, false]] as const) {
    let p = 100;
    const candles: OHLCV[] = [];
    for (let i = 0; i < 1500; i++) {
      const o = p; p = Math.max(1, p * (1 + (rand() - 0.5) * 0.02));
      candles.push({ time: 1_700_000_000 + i * 900, open: o, high: Math.max(o, p) * (1 + rand() * 0.005), low: Math.min(o, p) * (1 - rand() * 0.005), close: p, volume: 1 });
    }
    const ref = referenceUtBot(candles, a, c, h);
    const out = calculateUtBotSignals(candles, { a, c, h });
    assert.deepEqual(out.buySignals.map((s) => s.time), ref.buys, `BUY mismatch a=${a} c=${c} h=${h}`);
    assert.deepEqual(out.sellSignals.map((s) => s.time), ref.sells, `SELL mismatch a=${a} c=${c} h=${h}`);
    assert.ok(ref.buys.length > 5 && ref.sells.length > 5, 'fixture must exercise crossings');
    // Labels report the real exchange close of the signal candle.
    for (const s of out.buySignals) assert.equal(s.price, candles.find((x) => x.time === s.time)!.close);
  }
});

const noisyCandles = (n: number, seed0 = 11): OHLCV[] => {
  let seed = seed0;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let p = 50;
  return Array.from({ length: n }, (_, i) => {
    const o = p; p = Math.max(1, p * (1 + (rand() - 0.5) * 0.03));
    const wick = rand() < 0.15 ? 0.04 : 0.004;
    return { time: 1_700_000_000 + i * 300, open: o, high: Math.max(o, p) * (1 + wick * rand()), low: Math.min(o, p) * (1 - wick * rand()), close: p, volume: rand() < 0.1 ? 5000 : 1000 };
  });
};
const LOOSE_KEYS = { length: 20, wick_threshold: 0.3, volume_multiplier: 1.2, rsiOversold_Level: 50, rsiOverbought_Level: 50, Adx_trendThreshold: 5, useSARFilter: false };

await test('KEYS signals are causal: a longer history never changes earlier signals (no size-based warm-up)', () => {
  const all = noisyCandles(1600);
  for (const candleType of ['regular', 'heikin_ashi'] as const) {
    const full = calculateKeysIndicator(all, { ...LOOSE_KEYS, candleType });
    for (const cut of [60, 250, 900]) {
      const part = calculateKeysIndicator(all.slice(0, cut), { ...LOOSE_KEYS, candleType });
      const limit = all[cut - 1].time;
      assert.deepEqual(part.buySignals, full.buySignals.filter((s) => s.time <= limit), `${candleType} BUY prefix ${cut}`);
      assert.deepEqual(part.sellSignals, full.sellSignals.filter((s) => s.time <= limit), `${candleType} SELL prefix ${cut}`);
    }
    assert.ok(full.buySignals.length + full.sellSignals.length > 0, 'fixture must produce KEYS signals');
    assert.ok(full.buySignals.every((s) => s.time >= all[LOOSE_KEYS.length - 1].time), 'no signal before ta.highest/lowest are defined');
    // Signal labels report the real exchange close, never a synthetic HA price.
    for (const s of [...full.buySignals, ...full.sellSignals]) assert.equal(s.price, all.find((c) => c.time === s.time)!.close);
  }
});

await test('KEYS ADX follows Pine: ta.tr is na on bar 0 and DI uses fixnan', () => {
  const highs = [10, 11, 12, 13, 14, 15, 16, 17];
  const lows = [9, 10, 11, 12, 13, 14, 15, 16];
  const closes = [9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5];
  const { plusDI } = adx(highs, lows, closes, 3, 3);
  // TR, +DM and -DM all start on bar 1, so the first RMA (len 3) is bar 3.
  assert.equal(plusDI[2], null);
  assert.ok(plusDI[3] !== null);
  const r = rma([1, 2, 3, NaN, 5], 2);
  assert.equal(r[4], 0.5 * 5 + 0.5 * r[2]!, 'RMA continues from the last valid value');
});

await test('Indicator overlays are built lazily but remain complete', () => {
  const out = calculateKeysIndicator(noisyCandles(400), LOOSE_KEYS);
  assert.equal(out.plots.length, 7);
  assert.equal(out.plots[0].data.length, 400);
  assert.ok(Number.isNaN(out.plots[2].data[0].value), 'YPSAR is na before `length` bars, like Pine');
});

// ─── Persistence ────────────────────────────────────────────────────────────
await test('Indicators: create, update params, protect built-in KEYS code, delete', () => {
  const saved = storageService.saveIndicator({
    id: 'pine_persist', name: 'Persisted UT', version: 'v4', type: 'Indicator', lastUpdated: '', validationStatus: 'Backtest Ready',
    chartStatus: 'Chart Ready', code: UT_BOT_V4, params: [{ id: 'a', name: 'a', title: 'Key', type: 'float', default: 1, value: 2.5 }]
  });
  assert.ok(saved.lastUpdated, 'server returns the stored record');
  assert.equal(storageService.getIndicators().find((i) => i.id === 'pine_persist')!.params[0].value, 2.5);
  const keys = storageService.getIndicators().find((i) => i.id === 'keys_v6')!;
  storageService.saveIndicator({ ...keys, params: keys.params.map((p) => p.name === 'length' ? { ...p, value: 150 } : p) });
  assert.equal(storageService.getIndicators().find((i) => i.id === 'keys_v6')!.params.find((p) => p.name === 'length')!.value, 150);
  assert.throws(() => storageService.saveIndicator({ ...keys, code: `${ORIGINAL_KEYS_PINE_SCRIPT}\n// edited` }), /protected/);
  assert.throws(() => storageService.deleteIndicator('keys_v6'), /cannot be deleted/);
  assert.throws(() => storageService.saveIndicator({ ...saved, id: 'other_id' }), /already exists/);
  assert.equal(storageService.deleteIndicator('pine_persist'), true);
  assert.ok(!storageService.getIndicators().some((i) => i.id === 'pine_persist'));
});

await test('Selecting an indicator persists only indicatorId, never unsaved PnL/portfolio edits', () => {
  storageService.saveLabSettings({ portfolioConfig: baseConfig(), pnlConfig: PNL, indicatorId: 'keys_v6' });
  storageService.saveSelectedIndicatorId('ut_test');
  const settings = storageService.getLabSettings()!;
  assert.equal(settings.indicatorId, 'ut_test');
  assert.deepEqual(settings.pnlConfig, PNL);
  assert.deepEqual(settings.portfolioConfig, baseConfig());
});

await test('PnL rules validation (five stages, ranges, drops, fixed floor)', () => {
  assert.equal(validatePnLConfig(PNL), null);
  assert.match(validatePnLConfig({ ...PNL, rules: PNL.rules.slice(0, 4) })!, /Exactly 5/);
  assert.match(validatePnLConfig({ ...PNL, rules: PNL.rules.map((r, i) => i === 1 ? { ...r, fromPct: 70 } : r) })!, /overlapping/);
  assert.match(validatePnLConfig({ ...PNL, rules: PNL.rules.map((r, i) => i === 0 ? { ...r, toPct: 10 } : r) })!, /Profit To/);
  assert.match(validatePnLConfig({ ...PNL, rules: PNL.rules.map((r, i) => i === 2 ? { ...r, dropPct: 120 } : r) })!, /Profit Drop/);
  assert.match(validatePnLConfig({ ...PNL, fixedFloorEnabled: true, fixedFloorLockPct: 60 })!, /lock/);
  assert.equal(validatePnLConfig({ ...PNL, fixedFloorEnabled: true }), null);
});

await test('Symbol groups: CRUD, membership kept exactly, corrupted store is never overwritten', () => {
  const g = storageService.saveGroup({ id: 'crud', name: '  Crud  ', exchange: 'bybit', symbols: ['btcusdt', 'ETHUSDT', 'ETHUSDT'], createdAt: '', updatedAt: '' });
  assert.deepEqual(g.symbols, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(g.name, 'Crud');
  storageService.saveGroup({ ...g, name: 'Renamed', symbols: ['ETHUSDT'] });
  const reloaded = storageService.getGroups().find((x) => x.id === 'crud')!;
  assert.equal(reloaded.name, 'Renamed');
  assert.deepEqual(reloaded.symbols, ['ETHUSDT']);
  assert.equal(reloaded.createdAt, g.createdAt, 'rename keeps creation date');
  assert.throws(() => storageService.saveGroup({ ...g, exchange: 'nowhere' as any }), /Unsupported exchange/);
  assert.equal(storageService.deleteGroup('crud'), true);
  assert.equal(storageService.deleteGroup('crud'), false);
  const file = path.join(workDir, 'data', 'saved_groups.json');
  fs.writeFileSync(file, '{"truncated": ');
  assert.throws(() => storageService.saveGroup({ ...g, id: 'after_corruption' }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{"truncated": ', 'corrupted file left for recovery, not replaced by []');
  fs.writeFileSync(file, '[]');
});

await test('Backtest for a deleted/outdated group id fails cleanly', async () => {
  await assert.rejects(new BacktestService().runBacktest(baseConfig({ savedGroupId: 'deleted-id' }), PNL, UT_PARAMS, 't', 'ut_test'), /saved group/);
});

// ─── Market data ────────────────────────────────────────────────────────────
await test('Candle cache refresh downloads only the missing bars (not the whole year)', async () => {
  const svc = new ExchangeDataService() as any;
  const interval = 5;
  const lastCached = Math.floor(NOW / 300) * 300 - 3600; // 1h stale
  const cached = Array.from({ length: 2000 }, (_, i) => ({ time: lastCached - (1999 - i) * 300, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  fs.writeFileSync(path.join(svc.cacheDir, `bybit_ZZZUSDT_${interval}m_base.json`), JSON.stringify(cached));
  const calls: { count: number; end: number }[] = [];
  svc.downloadPaginatedKlines = async (_e: string, _s: string, _i: number, count: number, end = Date.now()) => {
    calls.push({ count, end });
    const endSec = Math.floor(end / 1000 / 300) * 300;
    return Array.from({ length: Math.min(count, 1000) }, (_, i) => ({ time: endSec - (Math.min(count, 1000) - 1 - i) * 300, open: 2, high: 2, low: 2, close: 2, volume: 2 }));
  };
  const out = await svc.getOHLCVCandles('bybit', 'ZZZUSDT', 5, 1500);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].count <= 20, `downloaded ${calls[0].count} bars for a 1h gap`);
  assert.equal(out.length, 1500);
  assert.ok(out.every((c: OHLCV, i: number) => i === 0 || c.time - out[i - 1].time === 300), 'no gaps or duplicates after merge');
});

await test('Bybit funding uses the same 1000x contract as klines and refuses truncated history', async () => {
  const svc = new ExchangeDataService();
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  try {
    globalThis.fetch = (async (url: string) => {
      const u = new URL(url);
      requested.push(u.searchParams.get('symbol')!);
      const end = Number(u.searchParams.get('endTime'));
      const list = Array.from({ length: 3 }, (_, i) => ({ fundingRateTimestamp: String(end - i * 28_800_000), fundingRate: '0.0001' }));
      return { ok: true, json: async () => ({ retCode: 0, result: { list } }) } as any;
    }) as any;
    const rates = await svc.getBybitFundingHistory('PEPEUSDT', NOW - 86400, NOW);
    assert.equal(requested[0], '1000PEPEUSDT');
    assert.ok(rates.length > 0);
    globalThis.fetch = (async (url: string) => {
      const end = Number(new URL(url).searchParams.get('endTime'));
      const list = Array.from({ length: 200 }, (_, i) => ({ fundingRateTimestamp: String(end - i * 3_600_000), fundingRate: '0.0001' }));
      return { ok: true, json: async () => ({ retCode: 0, result: { list } }) } as any;
    }) as any;
    await assert.rejects(svc.getBybitFundingHistory('LONGUSDT', NOW - 6 * 365 * 86400, NOW), /incomplete/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('Aggregation drops a leading partial bucket; tail merge keeps order', () => {
  const base = [600, 900, 1200, 1500, 1800, 2100].map((time) => ({ time, open: time, high: time + 1, low: time - 1, close: time, volume: 1 }));
  const agg = exchangeService.aggregateCandles(base, 15); // buckets 0 (partial: 600) , 900, 1800
  assert.deepEqual(agg.map((c) => c.time), [900, 1800]);
  const merged = mergeTail(base, [{ ...base[5], close: 9 }, { time: 2400, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
  assert.deepEqual(merged.map((c) => c.time), [600, 900, 1200, 1500, 1800, 2100, 2400]);
  assert.equal(merged[5].close, 9);
  assert.equal(lowerBound(base, 1000), 2);
});

await test('Chart live merge: unchanged polls keep identity, updates/appends are O(window), cap trims with slack', () => {
  const hist = Array.from({ length: 5000 }, (_, i) => ({ time: i * 300, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }));
  assert.equal(mergeRecentCandles(hist, hist.slice(-400).map((c) => ({ ...c })), 10000), hist, 'unchanged poll returns same array');
  const updated = mergeRecentCandles(hist, [{ ...hist[4999], close: 1.7 }, { time: 5000 * 300, open: 1.7, high: 1.7, low: 1.7, close: 1.7, volume: 1 }], 10000);
  assert.equal(updated.length, 5001);
  assert.equal(updated[4999].close, 1.7, 'closed bar final value applied');
  assert.equal(updated[0], hist[0], 'older bars untouched');
  const capped = mergeRecentCandles(hist, [{ time: 5000 * 300, open: 1, high: 1, low: 1, close: 1, volume: 1 }], 2000, 100);
  assert.equal(capped.length, 2000);
  const older = mergeOlderCandles(hist.slice(100), hist.slice(0, 150), 0, 1e6);
  assert.equal(older.length, 5000, 'overlapping history page is de-duplicated');
  assert.ok(older.every((c, i) => i === 0 || c.time > older[i - 1].time));
});

console.log('\nKEYS regression suite\n' + results.join('\n'));
console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
fs.rmSync(workDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
