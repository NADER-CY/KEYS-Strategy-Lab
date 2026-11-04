/**
 * Persistent Storage for Backtests, Symbol Groups, and Indicators
 */
import fs from 'fs';
import path from 'path';
import { BacktestRun, SavedSymbolGroup, SavedIndicator, PortfolioConfig, PnLConfig } from '../src/types';
import { SAVED_INDICATORS_DEFAULT } from '../src/engine/defaultPineScripts';

export class StorageService {
  private dataDir: string;
  private groupsFile: string;
  private backtestsFile: string;
  private indicatorsFile: string;
  private settingsFile: string;

  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.groupsFile = path.join(this.dataDir, 'saved_groups.json');
    this.backtestsFile = path.join(this.dataDir, 'backtest_runs.json');
    this.indicatorsFile = path.join(this.dataDir, 'indicators.json');
    this.settingsFile = path.join(this.dataDir, 'lab_settings.json');

    this.initDefaultData();
    this.resetHistoricBacktestsOnce();
  }

  getLabSettings(): { portfolioConfig: PortfolioConfig; pnlConfig: PnLConfig; indicatorId: string } | null {
    if (!fs.existsSync(this.settingsFile)) return null;
    try { return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); }
    catch { return null; }
  }

  saveLabSettings(settings: { portfolioConfig: PortfolioConfig; pnlConfig: PnLConfig; indicatorId: string }): void {
    const temporaryFile = `${this.settingsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(temporaryFile, this.settingsFile);
  }

  // One-time authorized reset of historical DEMO/real backtest reports.
  // Positions & Charts reads trades from the same stored runs, so this clears
  // both screens without touching symbol groups, indicators or candle caches.
  // Back up prior records before clearing and never seed demos again.
  private resetHistoricBacktestsOnce(): void {
    const marker = path.join(this.dataDir, '.backtests-reset-20261104.done');
    if (fs.existsSync(marker)) return;
    const previous = fs.readFileSync(this.backtestsFile, 'utf8');
    const backup = path.join(this.dataDir, 'backtest_runs.before_reset_20261104.json');
    if (!fs.existsSync(backup)) {
      fs.writeFileSync(backup, previous, { encoding: 'utf8', flag: 'wx' });
    }
    fs.writeFileSync(this.backtestsFile, '[]', 'utf8');
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
    console.info('KEYS: backed up and cleared historical backtest runs once');
  }

  private initDefaultData() {
    // Initialize default symbol groups if not present
    if (!fs.existsSync(this.groupsFile)) {
      const defaultGroups: SavedSymbolGroup[] = [
        {
          id: 'tab_100_bybit',
          name: 'Tab 1 — 100 Symbols',
          exchange: 'bybit',
          symbols: [
            'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'TRXUSDT', 'DOTUSDT',
            'LINKUSDT', 'POLUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'APTUSDT', 'SUIUSDT', 'NEARUSDT', 'FETUSDT', 'RENDERUSDT',
            'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT', 'BONKUSDT', 'UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'PENDLEUSDT', 'ENAUSDT', 'GALAUSDT',
            'AXSUSDT', 'SANDUSDT', 'MANAUSDT', 'TAOUSDT', 'WLDUSDT', 'ICPUSDT', 'SEIUSDT', 'TIAUSDT', 'KASUSDT', 'FTMUSDT',
            'STXUSDT', 'IMXUSDT', 'LDOUSDT', 'CRVUSDT', 'RUNEUSDT', 'FLOKIUSDT', 'BOMEUSDT', 'POPCATUSDT', 'NEIROUSDT', 'BLURUSDT'
          ],
          createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'tab_200_binance',
          name: 'Tab 200 — Binance Top 30',
          exchange: 'binance',
          symbols: [
            'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'PEPEUSDT',
            'WIFUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'FETUSDT', 'RNDRUSDT', 'AAVEUSDT', 'TAOUSDT', 'INJUSDT'
          ],
          createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'tab_defi_okx',
          name: 'Tab 3 — DeFi Leaders',
          exchange: 'okx',
          symbols: ['UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'PENDLEUSDT', 'ENAUSDT', 'LDOUSDT', 'CRVUSDT', 'RUNEUSDT', 'INJUSDT', 'LINKUSDT'],
          createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      fs.writeFileSync(this.groupsFile, JSON.stringify(defaultGroups, null, 2), 'utf8');
    }

    // Initialize default indicators
    if (!fs.existsSync(this.indicatorsFile)) {
      fs.writeFileSync(this.indicatorsFile, JSON.stringify(SAVED_INDICATORS_DEFAULT, null, 2), 'utf8');
    }

    // Initialize sample backtest runs matching Stitch UI
    if (!fs.existsSync(this.backtestsFile)) {
      const sampleRuns: BacktestRun[] = [
        this.createSampleRun('BT-0489', 'bybit', 'Tab 100', 50, 5, 'KEYS v1', 30, 300, 478.50, 178.50, 59.50, 68.4, 2.35, 12.6, 6, 842),
        this.createSampleRun('BT-0488', 'binance', 'Tab 200', 30, 15, 'Custom v2', 60, 300, 612.40, 312.40, 104.13, 71.2, 2.82, 18.9, 8, 1265),
        this.createSampleRun('BT-0487', 'okx', 'Tab 100', 50, 60, 'Trend Pro', 90, 300, 254.80, -45.20, -15.07, 54.9, 0.88, 22.3, 5, 419),
        this.createSampleRun('BT-0486', 'bybit', 'Tab 200', 30, 5, 'RSI+EMA', 30, 300, 397.80, 97.80, 32.60, 63.8, 1.84, 14.1, 6, 730),
        this.createSampleRun('BT-0485', 'binance', 'Tab 100', 50, 15, 'SuperTrend', 60, 300, 510.10, 210.10, 70.03, 66.1, 2.15, 16.8, 7, 1088),
        this.createSampleRun('BT-0484', 'bybit', 'Tab 100', 50, 60, 'KEYS v1', 90, 300, 231.70, -68.30, -22.77, 51.7, 0.76, 27.9, 4, 356),
        this.createSampleRun('BT-0483', 'binance', 'Tab 200', 30, 5, 'MACD Pro', 30, 300, 584.60, 284.60, 94.87, 69.9, 2.64, 15.5, 9, 1405),
        this.createSampleRun('BT-0482', 'okx', 'Tab 100', 50, 15, 'Grid v3', 60, 300, 356.40, 56.40, 18.80, 60.5, 1.45, 13.1, 5, 612)
      ];
      fs.writeFileSync(this.backtestsFile, JSON.stringify(sampleRuns, null, 2), 'utf8');
    }
  }

  private createSampleRun(
    id: string,
    exchange: any,
    groupName: string,
    symbolsCount: number,
    tf: number,
    strategy: string,
    days: number,
    initial: number,
    final: number,
    pnl: number,
    roi: number,
    winRate: number,
    pf: number,
    maxDd: number,
    cycles: number,
    trades: number
  ): BacktestRun {
    const now = Date.now();
    const startTimeSec = Math.floor((now - days * 86400000) / 1000);
    const endTimeSec = Math.floor(now / 1000);

    // Generate equity curve
    const pointsCount = 40;
    const equityCurve = [];
    const step = (endTimeSec - startTimeSec) / pointsCount;
    let eq = initial;
    let peak = initial;

    for (let i = 0; i <= pointsCount; i++) {
      const t = startTimeSec + Math.floor(i * step);
      const progress = i / pointsCount;
      const noise = (Math.sin(i * 1.5) * 0.15 + (Math.random() - 0.45) * 0.1) * (final - initial);
      eq = initial + progress * (final - initial) + noise;
      if (eq > peak) peak = eq;
      const dd = ((peak - eq) / peak) * 100;

      equityCurve.push({
        time: t,
        equity: Number(eq.toFixed(2)),
        balance: Number(eq.toFixed(2)),
        unrealizedPnl: Number((Math.random() * 5).toFixed(2)),
        peakEquity: Number(peak.toFixed(2)),
        drawdownPct: Number(Math.min(maxDd, dd).toFixed(2)),
        openPositionsCount: Math.floor(Math.random() * 8) + 2,
        cycleIndex: Math.floor(progress * cycles) + 1,
        activeFloorPct: 30
      });
    }

    return {
      id,
      name: `[DEMO] ${strategy} on ${groupName} (${tf}m)`,
      isDemo: true,
      createdAt: new Date(now - Math.random() * 4 * 86400000).toISOString(),
      exchange,
      symbolGroupId: 'tab_100_bybit',
      symbolGroupName: groupName,
      symbolsCount,
      timeframeMinutes: tf,
      strategyName: strategy,
      testPeriodDays: days,
      startDate: new Date(startTimeSec * 1000).toISOString().split('T')[0],
      endDate: new Date(endTimeSec * 1000).toISOString().split('T')[0],
      initialCapital: initial,
      finalBalance: final,
      netPnl: pnl,
      roiPct: roi,
      winRate,
      profitFactor: pf,
      maxDrawdownPct: maxDd,
      sharpeRatio: Number((roi / (maxDd * 1.8)).toFixed(2)),
      totalTrades: trades,
      winningTrades: Math.floor((trades * winRate) / 100),
      losingTrades: trades - Math.floor((trades * winRate) / 100),
      completedCycles: cycles,
      status: 'COMPLETED',
      durationSec: Math.floor(180 + Math.random() * 120),
      portfolioConfig: {
        exchange,
        savedGroupId: 'tab_100_bybit',
        initialCapital: initial,
        positionSizeNotional: 10,
        useMaxLeverage: true,
        manualLeverage: 10,
        marginMode: 'cross',
        maxOpenPositions: 100,
        cycleFromDay: 1,
        cycleToDay: 7,
        backtestTimeframe: tf,
        maxDrawdownCutoff: 15,
        slippageTolerance: 0.05,
        feeTakerPct: 0.055,
        feeMakerPct: 0.02,
        fundingRate8hPct: 0.01
      },
      pnlConfig: {
        rules: [
          { fromPct: 50, toPct: 80, dropPct: 30 },
          { fromPct: 81, toPct: 120, dropPct: 30 },
          { fromPct: 121, toPct: 150, dropPct: 30 },
          { fromPct: 151, toPct: 200, dropPct: 30 },
          { fromPct: 201, toPct: 500, dropPct: 30 }
        ],
        fixedFloorEnabled: false,
        fixedFloorTriggerPct: 50,
        fixedFloorLockPct: 30
      },
      indicatorParams: {
        length: 200,
        wick_threshold: 0.6,
        volumeSMA_Period: 20,
        volume_multiplier: 1.5,
        rsiPeriod: 14,
        rsiOversold_Level: 30,
        rsiOverbought_Level: 70,
        adxlen: 14,
        dilen: 14,
        Adx_trendThreshold: 30,
        useSARFilter: true,
        sarStart: 0.02,
        sarIncrement: 0.02,
        sarMaximum: 0.2
      },
      equityCurve,
      trades: [],
      cycles: [],
      logs: [
        `Initialized backtest ${id}`,
        `Loaded universe ${groupName} (${symbolsCount} symbols) on ${exchange}`,
        `Starting multi-cycle simulation over ${days} days with ${tf}m candles`,
        `5-Stage PnL drop floor active: [50-80% -> 30%, 81-120% -> 30%, 121-150% -> 30%, 151-200% -> 30%, 201-500% -> 30%]`,
        `Simulation completed successfully with ${cycles} cycles and ${trades} trades.`
      ]
    };
  }

  getGroups(): SavedSymbolGroup[] {
    try {
      const data = fs.readFileSync(this.groupsFile, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  saveGroup(group: SavedSymbolGroup): SavedSymbolGroup {
    const groups = this.getGroups();
    const idx = groups.findIndex((g) => g.id === group.id);
    if (idx >= 0) {
      groups[idx] = { ...group, updatedAt: new Date().toISOString() };
    } else {
      groups.push({ ...group, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    fs.writeFileSync(this.groupsFile, JSON.stringify(groups, null, 2), 'utf8');
    return group;
  }

  deleteGroup(groupId: string): boolean {
    const groups = this.getGroups().filter((g) => g.id !== groupId);
    fs.writeFileSync(this.groupsFile, JSON.stringify(groups, null, 2), 'utf8');
    return true;
  }

  getBacktestRuns(): BacktestRun[] {
    try {
      const data = fs.readFileSync(this.backtestsFile, 'utf8');
      const runs: BacktestRun[] = JSON.parse(data);
      // Clean up and mark demo runs, filter out incomplete test jobs
      const cleaned = runs.filter((r) => r && r.id && !r.id.startsWith('TEST-') && (r.status !== 'RUNNING' || Date.now() - new Date(r.createdAt).getTime() < 300000));
      cleaned.forEach((r) => {
        r.netPnl = Number(r.netPnl || 0);
        r.roiPct = Number(r.roiPct || 0);
        r.initialCapital = Number(r.initialCapital || 300);
        r.finalBalance = Number(r.finalBalance || 300);
        r.winRate = Number(r.winRate || 0);
        r.profitFactor = Number(r.profitFactor || 0);
        r.maxDrawdownPct = Number(r.maxDrawdownPct || 0);
        r.sharpeRatio = Number(r.sharpeRatio || 0);
        r.exchange = r.exchange || 'bybit';
        r.strategyName = r.strategyName || 'KEYS v6 Strategy';
        r.symbolGroupName = r.symbolGroupName || 'Tab 1 — 100 Symbols';
        r.symbolsCount = r.symbolsCount || 50;
        r.timeframeMinutes = r.timeframeMinutes || 5;
        // Zero is meaningful: a run can finish with only OPEN positions and
        // an unfinished cycle. Do not replace zero with old demo defaults.
        r.totalTrades = r.totalTrades ?? (r.trades ? r.trades.filter((trade) => trade.status === 'CLOSED').length : 0);
        r.completedCycles = r.completedCycles ?? (r.cycles?.length ?? 0);
        r.status = r.status || 'COMPLETED';
        r.trades = r.trades || [];
        r.equityCurve = r.equityCurve || [];
        r.logs = r.logs || [];

        if (r.id.startsWith('BT-048')) {
          r.isDemo = true;
          if (!r.name.startsWith('[DEMO]')) {
            r.name = `[DEMO] ${r.name}`;
          }
          if (r.trades.length === 0) {
            const startSec = r.startDate ? Math.floor(new Date(r.startDate).getTime() / 1000) : Math.floor(Date.now() / 1000) - 30 * 86400;
            const endSec = r.endDate ? Math.floor(new Date(r.endDate).getTime() / 1000) : Math.floor(Date.now() / 1000);
            r.trades = this.generateSampleTrades(r.id, startSec, endSec, r.timeframeMinutes || 5, r.completedCycles || 4);
          }
        }
      });
      return cleaned;
    } catch {
      return [];
    }
  }

  private generateSampleTrades(id: string, startTimeSec: number, endTimeSec: number, tf: number, cycles: number) {
    const sampleSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'PEPEUSDT', 'NEARUSDT', 'APTUSDT'];
    const basePrices: Record<string, number> = {
      BTCUSDT: 68420.5,
      ETHUSDT: 2480.25,
      SOLUSDT: 178.6,
      DOGEUSDT: 0.165,
      AVAXUSDT: 27.8,
      LINKUSDT: 11.45,
      SUIUSDT: 2.15,
      PEPEUSDT: 0.0000092,
      NEARUSDT: 4.85,
      APTUSDT: 9.35
    };

    const trades = [];
    const count = 12;
    const step = Math.max(600, Math.floor((endTimeSec - startTimeSec) / (count + 1)));
    for (let i = 0; i < count; i++) {
      const sym = sampleSymbols[i % sampleSymbols.length];
      const baseP = basePrices[sym] || 100;
      const isWin = i % 3 !== 2;
      const side = (i % 2 === 0 ? 'BUY' : 'SELL') as 'BUY' | 'SELL';
      const entryTime = startTimeSec + (i + 1) * step;
      const exitTime = entryTime + tf * 60 * (6 + (i % 6));
      const priceChangePct = isWin ? 0.02 + (i % 5) * 0.012 : -0.015 - (i % 3) * 0.01;
      const entryPrice = baseP;
      const exitPrice = Number((side === 'BUY' ? baseP * (1 + priceChangePct) : baseP * (1 - priceChangePct)).toFixed(4));
      const notional = 10;
      const leverage = 10;
      const margin = 1;
      const pnlPct = Number((priceChangePct * leverage * 100).toFixed(1));
      const pnlUsdt = Number((priceChangePct * notional * leverage).toFixed(2));
      const exitReason = isWin ? (i % 2 === 0 ? 'PNL_DROP_FLOOR' : 'CYCLE_EXPIRY') : (i % 4 === 1 ? 'MAX_DRAWDOWN' : 'CYCLE_EXPIRY');

      trades.push({
        id: `TR-${id}-${i + 1}`,
        symbol: sym,
        side,
        entryTime,
        entryPrice,
        exitTime,
        exitPrice,
        notional,
        leverage,
        margin,
        pnlUsdt,
        pnlPct,
        feePaid: 0.011,
        fundingPaid: 0.002,
        status: 'CLOSED' as const,
        exitReason: exitReason as any,
        cycleIndex: Math.floor((i / count) * cycles) + 1
      });
    }
    return trades;
  }

  getBacktestRunById(id: string): BacktestRun | undefined {
    return this.getBacktestRuns().find((r) => r.id === id);
  }

  saveBacktestRun(run: BacktestRun): BacktestRun {
    const runs = this.getBacktestRuns();
    const idx = runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) {
      runs[idx] = run;
    } else {
      runs.unshift(run);
    }
    fs.writeFileSync(this.backtestsFile, JSON.stringify(runs, null, 2), 'utf8');
    return run;
  }

  deleteBacktestRun(id: string): boolean {
    const runs = this.getBacktestRuns().filter((r) => r.id !== id);
    fs.writeFileSync(this.backtestsFile, JSON.stringify(runs, null, 2), 'utf8');
    return true;
  }

  getIndicators(): SavedIndicator[] {
    try {
      const data = fs.readFileSync(this.indicatorsFile, 'utf8');
      const indicators: SavedIndicator[] = JSON.parse(data);
      // The initially seeded KEYS v6 profile accidentally disabled SAR,
      // contrary to its original Pine input.bool(true). Correct ONLY that
      // untouched seed; preserve all subsequently saved user preferences.
      const untouchedSeed = indicators.find((indicator) =>
        indicator.id === 'keys_v6' && indicator.lastUpdated === '2026-11-02 10:45'
      );
      const sarParam = untouchedSeed?.params.find((param) => param.name === 'useSARFilter');
      if (sarParam && sarParam.default === false && sarParam.value === false) {
        sarParam.default = true;
        sarParam.value = true;
        const temporaryFile = `${this.indicatorsFile}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify(indicators, null, 2), 'utf8');
        fs.renameSync(temporaryFile, this.indicatorsFile);
      }
      return indicators;
    } catch {
      return SAVED_INDICATORS_DEFAULT;
    }
  }

  saveIndicator(indicator: SavedIndicator): SavedIndicator {
    const indicators = this.getIndicators();
    const idx = indicators.findIndex((i) => i.id === indicator.id);
    if (idx >= 0) {
      indicators[idx] = { ...indicator, lastUpdated: new Date().toISOString() };
    } else {
      indicators.push(indicator);
    }
    fs.writeFileSync(this.indicatorsFile, JSON.stringify(indicators, null, 2), 'utf8');
    return indicator;
  }

  deleteIndicator(id: string): boolean {
    const indicators = this.getIndicators().filter((i) => i.id !== id);
    fs.writeFileSync(this.indicatorsFile, JSON.stringify(indicators, null, 2), 'utf8');
    return true;
  }
}

export const storageService = new StorageService();
