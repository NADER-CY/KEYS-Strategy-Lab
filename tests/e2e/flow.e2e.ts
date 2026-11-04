/**
 * Browser end-to-end test of the approved UI (production build in dist/):
 * Create indicator → Save → Select → Change parameters → Apply → Save
 * settings → Reload → Run backtest → View results, plus fullscreen rendering.
 *
 * The real Express server, storage and backtest engine run in-process. Only
 * the exchange network boundary is replaced by deterministic, clearly labelled
 * FIXTURE candles so the test is reproducible on CI (Bybit blocks many CI IPs).
 * Nothing here can place an order: the app has no order-execution code path.
 *
 * Usage: npm run build && npm run test:e2e
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!fs.existsSync(path.join(repoRoot, 'dist', 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-e2e-'));
process.chdir(workDir);
process.env.NODE_ENV = 'production';
const PORT = 3197;
process.env.PORT = String(PORT);

const { exchangeService } = await import('../../server/exchanges');
type OHLCV = import('../../src/types').OHLCV;

// ── Deterministic FIXTURE market (test only) ────────────────────────────────
const FIXTURE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const basePrice: Record<string, number> = { BTCUSDT: 70000, ETHUSDT: 3500, SOLUSDT: 150 };
function fixtureBar(symbol: string, tf: number, time: number): OHLCV {
  const k = time / (tf * 60);
  const base = basePrice[symbol] ?? 10;
  const wave = (x: number) => base * (1 + 0.03 * Math.sin(x / 23) + 0.012 * Math.sin(x / 5.3));
  const open = wave(k - 1);
  const close = wave(k);
  return { time, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 1000 + 400 * Math.abs(Math.sin(k / 3)) };
}
function fixtureSeries(symbol: string, tf: number, count: number, beforeSec = Infinity): OHLCV[] {
  const step = tf * 60;
  const now = Math.floor(Date.now() / 1000);
  let last = Math.floor(now / step) * step; // includes the forming bar, like an exchange
  if (Number.isFinite(beforeSec)) last = Math.min(last, Math.floor((beforeSec - 1) / step) * step);
  return Array.from({ length: count }, (_, i) => fixtureBar(symbol, tf, last - (count - 1 - i) * step));
}
const svc = exchangeService as any;
svc.getOHLCVCandles = async (_e: string, symbol: string, tf: number, count: number) => fixtureSeries(symbol, tf, count);
svc.getOHLCVCandlesBefore = async (_e: string, symbol: string, tf: number, before: number, count: number) =>
  fixtureSeries(symbol, tf, Math.min(1000, count), before);
svc.getLiveSymbols = async () => FIXTURE_SYMBOLS.map((symbol) => ({
  symbol, baseAsset: symbol.replace('USDT', ''), quoteAsset: 'USDT', exchange: 'bybit', maxLeverage: 100,
  minNotional: 5, pricePrecision: 2, quantityPrecision: 3, category: 'Other', lastPrice: basePrice[symbol],
  change24h: 0, volume24h: 1, fundingRate: 0.01
}));
svc.getBybitSymbols = svc.getLiveSymbols;
svc.getContractMeta = async (_e: string, symbol: string) => (await svc.getLiveSymbols()).find((s: any) => s.symbol === symbol);
svc.getBybitFundingHistory = async (_s: string, from: number, to: number) => {
  const out = [];
  for (let t = Math.ceil(from / 28800) * 28800; t <= to; t += 28800) out.push({ time: t, rate: 0.0001 });
  return out;
};
svc.getBybitTimeframeChanges = async () => ({});

// Serve the real production build from the repository.
process.chdir(workDir);
await import(pathToFileURL(path.join(repoRoot, 'server.ts')).href);
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${base}/api/exchanges`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 100));
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
ema   = ema(src,1)
above = crossover(ema, xATRTrailingStop)
below = crossover(xATRTrailingStop, ema)
buy  = src > xATRTrailingStop and above
sell = src < xATRTrailingStop and below`;

const steps: string[] = [];
const step = (name: string) => { steps.push(name); console.log(`  → ${name}`); };
let exitCode = 0;
// Playwright is installed only on CI (not a project dependency); a computed
// specifier keeps `tsc --noEmit` independent of it.
const playwrightModule = 'playwright';
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrors: string[] = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  // Test setup: a 2-symbol group and a 30-day / 15m configuration.
  await fetch(`${base}/api/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'e2e_group', name: 'E2E Group', exchange: 'bybit', symbols: ['BTCUSDT', 'ETHUSDT'] }) });
  const settings = await (await fetch(`${base}/api/lab-settings`)).json();
  const portfolioConfig = {
    exchange: 'bybit', savedGroupId: 'e2e_group', initialCapital: 300, positionSizeNotional: 10, useMaxLeverage: true,
    manualLeverage: 10, marginMode: 'cross', maxOpenPositions: 10, cycleFromDay: 1, cycleToDay: 7, backtestTimeframe: 15,
    testPeriodDays: 30, maxDrawdownCutoff: 0, slippageTolerance: 0.05, feeTakerPct: 0.055, feeMakerPct: 0.02, fundingRate8hPct: 0.01
  };
  const pnlConfig = settings?.pnlConfig || {
    rules: [
      { fromPct: 50, toPct: 80, dropPct: 30 }, { fromPct: 81, toPct: 120, dropPct: 30 }, { fromPct: 121, toPct: 150, dropPct: 30 },
      { fromPct: 151, toPct: 200, dropPct: 30 }, { fromPct: 201, toPct: 500, dropPct: 30 }
    ], fixedFloorEnabled: false, fixedFloorTriggerPct: 50, fixedFloorLockPct: 30
  };
  const seeded = await fetch(`${base}/api/lab-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portfolioConfig, pnlConfig, indicatorId: 'keys_v6' }) });
  if (!seeded.ok) throw new Error(`seeding settings failed: ${await seeded.text()}`);

  await page.goto(`${base}/chart-backtest`);
  await page.locator('.keys-chart-frame canvas').first().waitFor({ timeout: 30_000 });
  step('Chart page rendered');

  // 1. Create + name + save a new indicator.
  await page.getByRole('button', { name: 'Pine Script Tab' }).click();
  await page.getByRole('button', { name: '+ Add Indicator' }).click();
  await page.getByPlaceholder('e.g. EMA 50').fill('E2E UT Bot');
  await page.getByPlaceholder('Paste your Pine Script here…').fill(UT_BOT_V4);
  await page.getByRole('button', { name: 'Save Indicator' }).click();
  await page.getByRole('dialog', { name: 'Add Pine Script indicator' }).waitFor({ state: 'detached', timeout: 10_000 });
  const stored = await (await fetch(`${base}/api/indicators`)).json();
  if (!stored.some((i: any) => i.name === 'E2E UT Bot')) throw new Error('indicator not persisted on the server');
  step('Indicator created, named and saved');

  // 2. It is the selected indicator.
  const selectedName = await page.locator('#strategy-profile option:checked').textContent();
  if (selectedName?.trim() !== 'E2E UT Bot') throw new Error(`selected indicator is "${selectedName}"`);
  step('Indicator selected');

  // 3. Change a parameter, apply, save.
  await page.getByRole('button', { name: 'Indicator Settings' }).click();
  const keyInput = page.locator('label', { has: page.locator('span.font-mono', { hasText: /^a$/ }) }).locator('input');
  await keyInput.fill('2.5');
  await page.getByRole('button', { name: 'Apply to Chart' }).click();
  await page.getByText('Applied to chart').waitFor();
  step('Parameter changed and applied');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await page.getByText('Saved permanently').waitFor();
  step('Indicator settings saved');

  // 4. Reload: selection and parameter must be restored from the server.
  await page.reload();
  await page.locator('.keys-chart-frame canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#strategy-profile')?.selectedOptions[0]?.textContent?.trim() === 'E2E UT Bot', null, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Indicator Settings' }).click();
  const restored = await page.locator('label', { has: page.locator('span.font-mono', { hasText: /^a$/ }) }).locator('input').inputValue();
  if (Number(restored) !== 2.5) throw new Error(`parameter after reload is ${restored}`);
  step('Selection and parameter restored after reload');

  // 5. Fullscreen must render candles (it was blank until the next poll) and Esc exits.
  await page.getByTitle('Fullscreen Chart').click();
  await page.waitForTimeout(1200);
  const candlePixels = await page.evaluate(() => {
    let colored = 0;
    for (const canvas of Array.from(document.querySelectorAll<HTMLCanvasElement>('.keys-chart-frame canvas'))) {
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width || !canvas.height) continue;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 16) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if ((g > 150 && r < 60 && b > 80 && b < 150) || (r > 220 && g < 110 && b > 70 && b < 130)) colored++;
      }
    }
    return colored;
  });
  const frame = await page.locator('.keys-chart-frame').boundingBox();
  if (candlePixels < 50) throw new Error(`fullscreen chart has no candles (${candlePixels} candle pixels)`);
  if (!frame || frame.width < 1500 || frame.height < 900) throw new Error(`fullscreen frame is ${JSON.stringify(frame)}`);
  step(`Fullscreen renders candles (${candlePixels} sampled candle pixels, ${Math.round(frame.width)}x${Math.round(frame.height)})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  if (await page.getByTitle('Exit Fullscreen').count()) {
    // Native fullscreen consumes the first Esc; the fallback listens for keydown.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  if (await page.getByTitle('Exit Fullscreen').count()) throw new Error('Esc did not exit fullscreen');
  step('Esc exits fullscreen');

  // 6. Run the backtest with the saved parameters and open the results.
  await page.getByRole('button', { name: /Run Backtest/ }).click();
  await page.getByRole('button', { name: 'View Results' }).waitFor({ timeout: 180_000 });
  step('Backtest completed');
  const runs = await (await fetch(`${base}/api/backtest/runs`)).json();
  const run = runs[0];
  if (run.status !== 'COMPLETED') throw new Error(`run status ${run.status}: ${run.error}`);
  if (run.indicatorId === 'keys_v6' || run.indicatorParams.a !== 2.5) throw new Error(`backtest used ${run.indicatorId} with a=${run.indicatorParams.a}`);
  if (run.symbolGroupId !== 'e2e_group') throw new Error(`backtest used group ${run.symbolGroupId}`);
  await page.getByRole('button', { name: 'View Results' }).click();
  await page.waitForURL(/\/backtest-results$/);
  await page.getByText(run.id).first().waitFor({ timeout: 10_000 });
  step(`Results page shows ${run.id} (${run.totalTrades} closed trades, net ${run.netPnl} USDT on fixture data)`);

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log(`\nE2E PASS (${steps.length} steps)`);
} catch (error) {
  exitCode = 1;
  console.error('\nE2E FAIL:', error);
  try { await page.screenshot({ path: path.join(repoRoot, 'e2e-failure.png'), fullPage: true }); } catch { /* ignore */ }
} finally {
  await browser.close();
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(exitCode);
}
