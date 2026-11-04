/**
 * Express Full-Stack Server for KEYS Strategy Lab
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { SUPPORTED_EXCHANGES, exchangeService } from './server/exchanges.ts';
import { storageService } from './server/storage.ts';
import { backtestService } from './server/backtestService.ts';
import { ExchangeId } from './src/types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // --- API Routes ---

  // 1. Exchanges
  app.get('/api/exchanges', (req, res) => {
    res.json(SUPPORTED_EXCHANGES);
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
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/groups/:id', (req, res) => {
    storageService.deleteGroup(req.params.id);
    res.json({ success: true });
  });

  // 4. OHLCV Market Data Candles
  app.get('/api/candles', async (req, res) => {
    try {
      const exchange = (req.query.exchange as ExchangeId) || 'bybit';
      const symbol = (req.query.symbol as string) || 'BTCUSDT';
      const timeframeMinutes = Number(req.query.timeframe) || 5;
      const limit = Number(req.query.limit) || 500;

      const candles = await exchangeService.getOHLCVCandles(
        exchange,
        symbol,
        timeframeMinutes,
        limit
      );
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
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/indicators/:id', (req, res) => {
    storageService.deleteIndicator(req.params.id);
    res.json({ success: true });
  });

  // 6. Backtest Execution
  app.post('/api/backtest/run', async (req, res) => {
    try {
      const { portfolioConfig, pnlConfig, indicatorParams, strategyName } = req.body;
      if (!portfolioConfig || !pnlConfig) {
        return res.status(400).json({ error: 'Missing portfolio or PnL configuration' });
      }

      const runId = await backtestService.runBacktest(
        portfolioConfig,
        pnlConfig,
        indicatorParams || {},
        strategyName || 'KEYS v6 Strategy'
      );

      res.json({ runId, status: 'RUNNING' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
    storageService.deleteBacktestRun(req.params.id);
    res.json({ success: true });
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
