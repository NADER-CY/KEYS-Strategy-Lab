/**
 * Express Full-Stack Server for KEYS Strategy Lab
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { SUPPORTED_EXCHANGES, exchangeService } from './server/exchanges.ts';
import { storageService } from './server/storage.ts';
import { backtestService } from './server/backtestService.ts';
import { ExchangeId } from './src/types/index.ts';
import { validatePnLConfig } from './src/engine/pnlRules.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Commit of the running source tree, so deployments can be verified.
const RUNNING_COMMIT = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return 'unknown';
  }
})();
const STARTED_AT = new Date().toISOString();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // --- API Routes ---

  app.get('/api/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, commit: RUNNING_COMMIT, startedAt: STARTED_AT });
  });

  // 1. Exchanges
  app.get('/api/exchanges', (req, res) => {
    res.json(SUPPORTED_EXCHANGES);
  });

  app.get('/api/lab-settings', (_req, res) => {
    res.json(storageService.getLabSettings());
  });

  app.put('/api/lab-settings', (req, res) => {
    const { portfolioConfig, pnlConfig, indicatorId } = req.body || {};
    if (!portfolioConfig || typeof portfolioConfig !== 'object' || !pnlConfig || typeof indicatorId !== 'string') {
      return res.status(400).json({ error: 'Invalid lab settings' });
    }
    const pnlError = validatePnLConfig(pnlConfig);
    if (pnlError) return res.status(400).json({ error: pnlError });
    try {
      storageService.saveLabSettings({ portfolioConfig, pnlConfig, indicatorId });
      // Confirm persistence by reading the file back, not by assumption.
      const stored = storageService.getLabSettings();
      const persisted = JSON.stringify(stored?.pnlConfig) === JSON.stringify(pnlConfig) &&
        JSON.stringify(stored?.portfolioConfig) === JSON.stringify(portfolioConfig) && stored?.indicatorId === indicatorId;
      if (!persisted) return res.status(500).json({ error: 'Settings could not be verified after saving.' });
      res.json({ saved: true, settings: stored });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Selecting an indicator on the chart persists ONLY that choice; unsaved
  // portfolio / PnL edits must not be written as a side effect.
  app.put('/api/lab-settings/indicator', (req, res) => {
    const { indicatorId } = req.body || {};
    if (typeof indicatorId !== 'string' || !storageService.getIndicators().some((i) => i.id === indicatorId)) {
      return res.status(400).json({ error: 'Unknown indicator' });
    }
    try {
      storageService.saveSelectedIndicatorId(indicatorId);
      res.json({ saved: storageService.getLabSettings()?.indicatorId === indicatorId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Symbols
  app.get('/api/symbols', async (req, res) => {
    try {
      const exchange = (req.query.exchange as ExchangeId) || 'bybit';
      const category = req.query.category as string;
      const search = String(req.query.search || '').toUpperCase();
      let symbols = await exchangeService.getLiveSymbols(exchange);
      if (category && category.toLowerCase() !== 'all') {
        symbols = symbols.filter((s) => s.category.toUpperCase() === category.toUpperCase());
      }
      if (search) symbols = symbols.filter((s) => s.symbol.includes(search) || s.baseAsset.includes(search));
      res.set('Cache-Control', 'public, max-age=60');
      res.json(symbols);
    } catch (e: any) {
      res.status(502).json({ error: `Exchange symbols unavailable: ${e.message}` });
    }
  });

  // Historical percentage changes for a limited set of visible Bybit USDT perpetual contracts.
  app.get('/api/symbols/changes', async (req, res) => {
    const requested = String(req.query.symbols || '').split(',')
      .map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (requested.length > 100 || requested.some((s) => !/^[A-Z0-9]{2,35}USDT$/.test(s))) {
      return res.status(400).json({ error: 'Supply at most 100 valid USDT perpetual symbols' });
    }
    try {
      const allowed = new Set((await exchangeService.getBybitSymbols()).map((s) => s.symbol));
      const unique = [...new Set(requested)].filter((s) => allowed.has(s));
      const changes: Record<string, Record<string, number | null>> = {};
      let index = 0;
      // Concurrency cap protects Bybit public rate limits.
      await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
        while (index < unique.length) {
          const symbol = unique[index++];
          try {
            changes[symbol] = await exchangeService.getBybitTimeframeChanges(symbol);
          } catch (e: any) {
            console.warn(`Unable to load Bybit returns for ${symbol}: ${e.message}`);
            changes[symbol] = {};
          }
        }
      }));
      res.set('Cache-Control', 'public, max-age=60');
      res.json(changes);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // 3. Saved Symbol Groups
  app.get('/api/groups', (req, res) => {
    res.json(storageService.getGroups());
  });

  app.post('/api/groups', (req, res) => {
    try {
      const group = req.body;
      if (!group.id || !group.name || !group.exchange || !Array.isArray(group.symbols)) {
        return res.status(400).json({ error: 'Invalid group data' });
      }
      const saved = storageService.saveGroup(group);
      res.json(saved);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/groups/:id', (req, res) => {
    try {
      const deleted = storageService.deleteGroup(req.params.id);
      res.json({ success: true, deleted });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4. OHLCV Market Data Candles
  app.get('/api/candles', async (req, res) => {
    try {
      const exchange = (req.query.exchange as ExchangeId) || 'bybit';
      const symbol = (req.query.symbol as string) || 'BTCUSDT';
      const timeframeMinutes = Number(req.query.timeframe) || 5;
      if (!Number.isInteger(timeframeMinutes) || timeframeMinutes < 1 || timeframeMinutes > 43200) {
        return res.status(400).json({ error: 'Invalid timeframe' });
      }
      // Chart requests are small windows; older history uses /history-page.
      const limit = Math.min(5000, Math.max(1, Math.floor(Number(req.query.limit) || 500)));
      const live = req.query.live === '1';

      const candles = await exchangeService.getOHLCVCandles(
        exchange,
        symbol,
        timeframeMinutes,
        limit,
        live
      );
      res.set('Cache-Control', 'no-store');
      res.json(candles);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Fetch older chart candles in bounded pages. Large one-year history no
  // longer blocks the initial chart or requires a single long HTTP request.
  app.get('/api/candles/history-page', async (req, res) => {
    try {
      const exchange = (req.query.exchange as ExchangeId) || 'bybit';
      const symbol = (req.query.symbol as string) || 'BTCUSDT';
      const timeframe = Number(req.query.timeframe) || 15;
      if (!Number.isInteger(timeframe) || timeframe < 1 || timeframe > 43200) {
        return res.status(400).json({ error: 'Invalid timeframe' });
      }
      const before = Number(req.query.before);
      if (!Number.isFinite(before) || before <= 0) {
        return res.status(400).json({ error: 'Valid before timestamp required.' });
      }
      const candles = await exchangeService.getOHLCVCandlesBefore(
        exchange, symbol, timeframe, before, Number(req.query.limit) || 1000
      );
      res.set('Cache-Control', 'no-store');
      res.json(candles);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 5. Indicators
  app.get('/api/indicators', (req, res) => {
    res.json(storageService.getIndicators());
  });

  app.post('/api/indicators', (req, res) => {
    try {
      const indicator = req.body;
      const saved = storageService.saveIndicator(indicator);
      res.json(saved);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/indicators/:id', (req, res) => {
    if (req.params.id === 'keys_v6') return res.status(403).json({ error: 'Built-in KEYS indicator cannot be deleted.' });
    try {
      const deleted = storageService.deleteIndicator(req.params.id);
      res.json({ success: true, deleted });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 6. Backtest Execution
  app.post('/api/backtest/run', async (req, res) => {
    try {
      const { portfolioConfig, pnlConfig, indicatorParams, strategyName, indicatorId } = req.body;
      if (!portfolioConfig || !pnlConfig) {
        return res.status(400).json({ error: 'Missing portfolio or PnL configuration' });
      }

      const runId = await backtestService.runBacktest(
        portfolioConfig,
        pnlConfig,
        indicatorParams || {},
        strategyName || 'KEYS v6 Strategy',
        indicatorId
      );

      res.json({ runId, status: 'RUNNING' });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/backtest/status/:id', (req, res) => {
    const job = backtestService.getActiveJob(req.params.id);
    if (!job) {
      const run = storageService.getBacktestRunById(req.params.id);
      if (run) {
        return res.json({
          status: run.status,
          progress: 100,
          run
        });
      }
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      status: job.run.status,
      progress: job.progress,
      currentDate: job.currentDate,
      openPositionsCount: job.openPositionsCount,
      run: job.run
    });
  });

  app.post('/api/backtest/stop/:id', (req, res) => {
    const success = backtestService.stopJob(req.params.id);
    res.json({ success });
  });

  // 7. Backtest Results
  app.get('/api/backtest/runs', (req, res) => {
    res.json(storageService.getBacktestRuns());
  });

  app.get('/api/backtest/runs/:id', (req, res) => {
    const run = storageService.getBacktestRunById(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    res.json(run);
  });

  app.delete('/api/backtest/runs/:id', (req, res) => {
    if (backtestService.getActiveJob(req.params.id)?.run.status === 'RUNNING') {
      return res.status(409).json({ error: 'Stop the running backtest before deleting it.' });
    }
    try {
      const deleted = storageService.deleteBacktestRun(req.params.id);
      res.json({ success: true, deleted });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Export report
  app.get('/api/backtest/export/:id', (req, res) => {
    const run = storageService.getBacktestRunById(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const format = req.query.format === 'csv' ? 'csv' : 'json';
    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${run.id}_report.json"`);
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(run, null, 2));
    } else {
      // CSV Export of trades
      res.setHeader('Content-Disposition', `attachment; filename="${run.id}_trades.csv"`);
      res.setHeader('Content-Type', 'text/csv');
      let csv = 'Trade ID,Symbol,Side,Entry Time,Exit Time,Entry Price,Exit Price,Notional (USDT),Leverage,Margin (USDT),Net PnL (USDT),PnL (%),Exit Reason,Cycle Index\n';
      for (const t of run.trades) {
        csv += `${t.id},${t.symbol},${t.side},${new Date(t.entryTime * 1000).toISOString()},${t.exitTime ? new Date(t.exitTime * 1000).toISOString() : ''},${t.entryPrice},${t.exitPrice || ''},${t.notional},${t.leverage}x,${t.margin},${t.pnlUsdt},${t.pnlPct}%,${t.exitReason || ''},${t.cycleIndex}\n`;
      }
      return res.send(csv);
    }
  });

  // 8. Download complete project source code ZIP
  app.get('/api/download-zip', (req, res) => {
    const zipPath = path.resolve(__dirname, 'public', 'keys-strategy-lab.zip');
    if (fs.existsSync(zipPath)) {
      res.download(zipPath, 'keys-strategy-lab-complete.zip');
    } else {
      res.status(404).json({ error: 'Zip archive not ready' });
    }
  });

  // --- Vite Dev Middleware or Production Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KEYS Strategy Lab Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start KEYS Strategy Lab server:', err);
  process.exit(1);
});
