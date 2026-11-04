/**
 * Full Backtesting Engine for KEYS Strategy Lab
 * Simulates multi-symbol crypto perpetual futures portfolios across time.
 * Simulation only: this module never submits exchange orders.
 */
import {
  BacktestRun,
  PortfolioConfig,
  PnLConfig,
  PositionTrade,
  CycleRecord,
  EquityPoint,
  ExitReason,
  OHLCV
} from '../src/types';
import { exchangeService, FundingEvent } from './exchanges';
import { storageService } from './storage';
import { calculateKeysIndicator } from '../src/engine/indicatorCalculations';
import { markOpenPositionsAtEnd } from '../src/engine/openPositionValuation';
import { calculateExecutedEntryPrice, calculateExecutedExitPrice } from '../src/engine/executionPrice';
import { ORIGINAL_KEYS_PINE_SCRIPT, isUtBotAlertsScript } from '../src/engine/defaultPineScripts';
import { calculateUtBotSignals } from '../src/engine/utBotCalculations';
import { toHeikinAshiCandles } from '../src/engine/indicatorCalculations';
import { toRenkoCandles, RENKO_BOX_SAMPLE_BARS } from '../src/engine/renkoChart';
import { hasCycleReachedExpiry } from '../src/engine/cycleTiming';
import { validatePnLConfig } from '../src/engine/pnlRules';

export interface ActiveJob {
  run: BacktestRun;
  stopped: boolean;
  progress: number; // 0 - 100
  currentDate?: string;
  openPositionsCount: number;
}

/** Finished jobs stay in memory briefly for status polling, then storage serves them. */
const FINISHED_JOB_RETENTION_MS = 10 * 60 * 1000;

export class BacktestService {
  private activeJobs: Map<string, ActiveJob> = new Map();

  getActiveJob(id: string): ActiveJob | undefined {
    return this.activeJobs.get(id);
  }

  stopJob(id: string): boolean {
    const job = this.activeJobs.get(id);
    if (job && job.run.status === 'RUNNING') {
      job.stopped = true;
      job.run.status = 'STOPPED';
      job.run.logs.push(`[${new Date().toISOString()}] Stop requested by user.`);
      storageService.saveBacktestRun(job.run);
      return true;
    }
    return false;
  }

  private scheduleJobEviction(id: string): void {
    const timer = setTimeout(() => this.activeJobs.delete(id), FINISHED_JOB_RETENTION_MS);
    (timer as any).unref?.();
  }

  /** Unique run id. The old 4-digit random id could overwrite a saved run. */
  private createRunId(): string {
    const existing = new Set(storageService.getBacktestRuns().map((r) => r.id));
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = `BT-${Math.floor(1000 + Math.random() * 9000)}`;
      if (!existing.has(candidate) && !this.activeJobs.has(candidate)) return candidate;
    }
    let candidate = `BT-${Date.now().toString(36).toUpperCase()}`;
    while (existing.has(candidate) || this.activeJobs.has(candidate)) candidate += 'X';
    return candidate;
  }

  /**
   * Starts a full backtest simulation asynchronously
   */
  async runBacktest(
    portfolioConfig: PortfolioConfig,
    pnlConfig: PnLConfig,
    indicatorParams: Record<string, any>,
    strategyName = 'KEYS v6 Liquidity Trap & SAR',
    indicatorId = 'keys_v6'
  ): Promise<string> {
    // The temporary research backtest mode never forces an exit due to a
    // portfolio drawdown threshold. Slippage remains an explicit recorded cost.
    portfolioConfig = { ...portfolioConfig, maxDrawdownCutoff: 0 };
    if (portfolioConfig.marginMode && portfolioConfig.marginMode !== 'cross') {
      throw new Error('Only cross-margin futures portfolios are simulated. Select Cross Margin and retry.');
    }
    const pnlError = validatePnLConfig(pnlConfig);
    if (pnlError) throw new Error(`Invalid PnL rules: ${pnlError}`);
    for (const [key, min] of [['initialCapital', 0], ['positionSizeNotional', 0], ['maxOpenPositions', 0], ['backtestTimeframe', 0]] as const) {
      if (!Number.isFinite(Number(portfolioConfig[key])) || Number(portfolioConfig[key]) <= min) {
        throw new Error(`${key} must be a positive number.`);
      }
    }

    // Resolve symbol group
    const groups = storageService.getGroups();
    const group = portfolioConfig.savedGroupId === '__all_exchange__'
      ? {
          id: '__all_exchange__',
          name: `All ${portfolioConfig.exchange.toUpperCase()} Symbols`,
          exchange: portfolioConfig.exchange,
          symbols: (await exchangeService.getLiveSymbols(portfolioConfig.exchange)).map((symbol) => symbol.symbol)
        }
      : groups.find((g) => g.id === portfolioConfig.savedGroupId);
    if (!group || group.symbols.length === 0) throw new Error('Select a saved group containing at least one symbol.');
    if (group.exchange !== portfolioConfig.exchange) throw new Error('Selected group exchange does not match the test exchange.');
    const indicator = storageService.getIndicators().find((i) => i.id === indicatorId);
    const isOriginalKeys = indicatorId === 'keys_v6' && indicator?.code.trim() === ORIGINAL_KEYS_PINE_SCRIPT.trim();
    const isUtBot = !!indicator && isUtBotAlertsScript(indicator.code);
    if (!indicator || (!isOriginalKeys && !isUtBot)) {
      throw new Error('This Pine Script does not have a verified executable backtest adapter. Supported scripts: original KEYS and UT Bot Alerts v4.');
    }
    // Persist and execute the exact same parameter snapshot. Omitted inputs
    // inherit the saved indicator profile, never an unrelated hardcoded value.
    const effectiveParams: Record<string, any> = {
      ...Object.fromEntries(indicator.params.map((param) => [param.name, param.value])),
      ...indicatorParams
    };
    // Renko bricks are spread across the BACKTEST candle interval, never the
    // chart's interval (which the chart passes along with its parameters).
    effectiveParams.renkoTimeframeMinutes = portfolioConfig.backtestTimeframe;
    if (isOriginalKeys && typeof effectiveParams.useSARFilter !== 'boolean') {
      throw new Error('Enable SAR Filter must be a boolean; refresh the indicator settings and retry.');
    }
    if (isUtBot && (!Number.isFinite(Number(effectiveParams.a)) || Number(effectiveParams.a) <= 0
      || !Number.isInteger(Number(effectiveParams.c)) || Number(effectiveParams.c) < 1
      || typeof effectiveParams.h !== 'boolean')) {
      throw new Error('UT Bot requires a positive Key Value (a), integer ATR Period (c), and boolean Heikin Ashi toggle (h).');
    }
    const testPeriodDays = Number(portfolioConfig.testPeriodDays || 30);
    if (![30, 90, 180, 365].includes(testPeriodDays)) throw new Error('Historical test period must be 30, 90, 180, or 365 days.');
    const symbols = [...new Set(group.symbols)];
    const runId = this.createRunId();

    const newRun: BacktestRun = {
      id: runId,
      name: `${indicator.name} on ${group.name} (${portfolioConfig.backtestTimeframe}m)`,
      createdAt: new Date().toISOString(),
      exchange: portfolioConfig.exchange,
      symbolGroupId: group.id,
      symbolGroupName: group.name,
      symbolsCount: symbols.length,
      timeframeMinutes: portfolioConfig.backtestTimeframe,
      strategyName: indicator.name,
      indicatorId,
      testPeriodDays,
      startDate: new Date(Date.now() - testPeriodDays * 86400000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      initialCapital: portfolioConfig.initialCapital,
      finalBalance: portfolioConfig.initialCapital,
      netPnl: 0,
      roiPct: 0,
      winRate: 0,
      profitFactor: 1,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      completedCycles: 0,
      status: 'RUNNING',
      durationSec: 0,
      portfolioConfig,
      pnlConfig,
      indicatorParams: effectiveParams,
      equityCurve: [],
      trades: [],
      cycles: [],
      logs: [
        `Started backtest ${runId} with ${symbols.length} symbols on ${portfolioConfig.exchange}`,
        `[INDICATOR] ${indicator.name} parameter snapshot: ${JSON.stringify(effectiveParams)}`
      ]
    };

    const job: ActiveJob = {
      run: newRun,
      stopped: false,
      progress: 0,
      openPositionsCount: 0
    };

    this.activeJobs.set(runId, job);
    storageService.saveBacktestRun(newRun);

    // Run execution in background worker process / async
    this.executeSimulation(job, symbols, portfolioConfig, pnlConfig, effectiveParams, isUtBot)
      .catch((err) => {
        console.error(`Backtest ${runId} error:`, err);
        if (job.run.status !== 'STOPPED') {
          job.run.status = 'FAILED';
          job.run.error = err.message;
          job.run.logs.push(`[ERROR] ${err.message}`);
        }
        storageService.saveBacktestRun(job.run);
      })
      .finally(() => this.scheduleJobEviction(runId));

    return runId;
  }

  private async executeSimulation(
    job: ActiveJob,
    symbols: string[],
    portfolioConfig: PortfolioConfig,
    pnlConfig: PnLConfig,
    indicatorParams: Record<string, any>,
    isUtBot = false
  ): Promise<void> {
    const run = job.run;
    const startTime = Date.now();
    const stepSec = portfolioConfig.backtestTimeframe * 60;

    // 1. Resolve REAL contract leverage limits from the exchange's live
    // instrument list. Unknown limits are never replaced by an invented 50x.
    const maxLeverageBySymbol = new Map<string, number>();
    // Contracts absent from the live instrument list (delisted / invalid) are
    // skipped like other symbols without full history, not silently priced.
    const unlistedSymbols = new Set<string>();
    for (const sym of symbols) {
      if (job.stopped) return;
      const meta = await exchangeService.getContractMeta(portfolioConfig.exchange, sym);
      if (!meta) {
        unlistedSymbols.add(sym);
        continue;
      }
      const exchangeMax = Number(meta?.maxLeverage) || 0;
      if (exchangeMax > 0) {
        maxLeverageBySymbol.set(sym, exchangeMax);
        if (!portfolioConfig.useMaxLeverage && portfolioConfig.manualLeverage > exchangeMax) {
          throw new Error(
            `Manual leverage ${portfolioConfig.manualLeverage}x exceeds maximum contract leverage of ${exchangeMax}x for ${sym} on ${portfolioConfig.exchange}.`
          );
        }
      } else if (portfolioConfig.useMaxLeverage) {
        throw new Error(`Maximum leverage for ${sym} is not published by ${portfolioConfig.exchange}; use manual leverage instead.`);
      } else {
        run.logs.push(`[LEVERAGE] ${sym}: ${portfolioConfig.exchange} does not publish a max leverage; manual ${portfolioConfig.manualLeverage}x could not be verified.`);
      }
    }

    // 2. Fetch OHLCV candles and compute indicator signals for all symbols
    run.logs.push(`Loading market candles for ${symbols.length} perpetual contracts on ${portfolioConfig.exchange}...`);
    const candleMap = new Map<string, OHLCV[]>();
    const signalMap = new Map<string, { buyMap: Map<number, { price: number; reason: string }>; sellMap: Map<number, { price: number; reason: string }>; adxMap: Map<number, number>; rsiMap: Map<number, number> }>();
    const requestedBars = Math.ceil((run.testPeriodDays * 1440) / portfolioConfig.backtestTimeframe);
    const candleType = indicatorParams.candleType || 'heikin_ashi';

    // Up to 4 symbols load concurrently; progress reflects symbols actually loaded.
    let nextSymbolIndex = 0;
    let loadedSymbolCount = 0;
    let processedSymbolCount = 0;
    const skippedSymbols: string[] = [];
    let loadError: Error | null = null;
    const loadSymbolWorker = async () => {
      while (!job.stopped && !loadError) {
      const symIdx = nextSymbolIndex++;
      if (symIdx >= symbols.length) return;
      const sym = symbols[symIdx];
      if (unlistedSymbols.has(sym)) {
        skippedSymbols.push(sym);
        processedSymbolCount++;
        run.logs.push(`[SKIPPED] ${sym}: not an active ${portfolioConfig.exchange} USDT perpetual (delisted or invalid); excluded from the full ${run.testPeriodDays}-day comparison.`);
        continue;
      }

      job.currentDate = `Loading ${sym} (${loadedSymbolCount}/${symbols.length})`;

      try {
        // One extra bar: the still-forming candle is removed below. Its OHLC
        // is not final, so it must not produce signals or valuations.
        const fetched = await exchangeService.getOHLCVCandles(
          portfolioConfig.exchange,
          sym,
          portfolioConfig.backtestTimeframe,
          requestedBars + 1
        );
        const nowSec = Math.floor(Date.now() / 1000);
        const candles = fetched.filter((c) => c.time + stepSec <= nowSec).slice(-requestedBars);
        if (candles.length < requestedBars - 2) {
          skippedSymbols.push(sym);
          run.logs.push(`[SKIPPED] ${sym}: only ${candles.length}/${requestedBars} candles available; excluded from the full ${run.testPeriodDays}-day comparison.`);
          processedSymbolCount++;
          job.progress = Math.min(25, Math.max(1, Math.floor((processedSymbolCount / symbols.length) * 25)));
          job.currentDate = `Checked ${processedSymbolCount}/${symbols.length} • ${skippedSymbols.length} skipped`;
          continue;
        }
        run.logs.push(`[DATA] ${sym}: ${candles.length} closed ${portfolioConfig.backtestTimeframe}m candles, ${new Date(candles[0].time * 1000).toISOString()} to ${new Date(candles[candles.length - 1].time * 1000).toISOString()}`);
        candleMap.set(sym, candles);

        // Compute indicator signals
        const signalCandles = candleType === 'renko'
          ? toRenkoCandles(candles, portfolioConfig.backtestTimeframe)
          : candleType === 'regular' ? candles : toHeikinAshiCandles(candles);
        const indicatorResult = isUtBot
          ? calculateUtBotSignals(signalCandles, indicatorParams, candleType === 'renko' ? signalCandles : candles)
          : calculateKeysIndicator(candles, indicatorParams);
        const buyMap = new Map<number, { price: number; reason: string }>();
        const sellMap = new Map<number, { price: number; reason: string }>();
        const adxMap = new Map<number, number>();
        const rsiMap = new Map<number, number>();

        // Renko bricks carry sub-bar timestamps; a brick belongs to the real
        // candle whose close formed it, so the entry is that candle's N+1 open.
        const signalBarTime = (time: number) => candleType === 'renko'
          ? Math.floor(time / stepSec) * stepSec
          : time;
        // The fixed Renko box is sized from the first bars of the window, so
        // signals inside that sample would use future information.
        const firstCausalTime = candleType === 'renko'
          ? candles[Math.min(RENKO_BOX_SAMPLE_BARS, candles.length - 1)].time
          : -Infinity;
        let suppressed = 0;
        const fallbackLabel = isUtBot ? 'UT Bot' : 'KEYS v6';
        for (const s of indicatorResult.buySignals) {
          const t = signalBarTime(s.time);
          if (t < firstCausalTime) { suppressed++; continue; }
          buyMap.set(t, { price: s.price, reason: s.reason || `${fallbackLabel} BUY` });
        }
        for (const s of indicatorResult.sellSignals) {
          const t = signalBarTime(s.time);
          if (t < firstCausalTime) { suppressed++; continue; }
          sellMap.set(t, { price: s.price, reason: s.reason || `${fallbackLabel} SELL` });
        }
        if (suppressed) run.logs.push(`[SIGNALS] ${sym}: ${suppressed} Renko signal(s) inside the ${RENKO_BOX_SAMPLE_BARS}-bar box-sizing window ignored to avoid look-ahead.`);

        // ADX/RSI arrays are indexed by the SIGNAL candles (Renko bricks differ
        // from exchange candles), so key them by the signal candle's bar time.
        const adxValues: (number | null)[] = 'adxValues' in indicatorResult ? indicatorResult.adxValues as (number | null)[] : [];
        const rsiValues: (number | null)[] = 'rsiValues' in indicatorResult ? indicatorResult.rsiValues as (number | null)[] : [];
        const keysCandles = isUtBot ? signalCandles
          : candleType === 'renko' ? toRenkoCandles(candles, portfolioConfig.backtestTimeframe) : candles;
        for (let i = 0; i < keysCandles.length; i++) {
          const t = signalBarTime(keysCandles[i].time);
          if (Number.isFinite(adxValues[i])) adxMap.set(t, adxValues[i]!);
          if (Number.isFinite(rsiValues[i])) rsiMap.set(t, rsiValues[i]!);
        }

        signalMap.set(sym, { buyMap, sellMap, adxMap, rsiMap });
        loadedSymbolCount++;
        processedSymbolCount++;
        job.progress = Math.min(25, Math.max(1, Math.floor((processedSymbolCount / symbols.length) * 25)));
        job.currentDate = `Checked ${processedSymbolCount}/${symbols.length} • ${skippedSymbols.length} skipped`;
        if (processedSymbolCount % 10 === 0) storageService.saveBacktestRun(run);
      } catch (err: any) {
        // A saved group can contain a contract that has since been delisted.
        // Skip only an explicit exchange rejection of that symbol; transient
        // network, rate-limit and server errors must still fail visibly.
        const reason = String(err?.message || err);
        if (/\b(?:Symbol Is Invalid|Invalid Symbol|symbol not found|unknown symbol)\b/i.test(reason)) {
          skippedSymbols.push(sym);
          processedSymbolCount++;
          run.logs.push(`[SKIPPED] ${sym}: exchange rejected the contract (${reason}); excluded from the full ${run.testPeriodDays}-day comparison.`);
          job.progress = Math.min(25, Math.max(1, Math.floor((processedSymbolCount / symbols.length) * 25)));
          job.currentDate = `Checked ${processedSymbolCount}/${symbols.length} • ${skippedSymbols.length} skipped`;
          continue;
        }
        loadError = new Error(`Cannot run complete ${run.testPeriodDays}-day test: ${err.message}`);
        return;
      }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, () => loadSymbolWorker()));
    if (job.stopped) return;
    if (loadError) throw loadError;

    const originallySelected = symbols.length;
    symbols = symbols.filter((symbol) => candleMap.has(symbol));
    run.symbolsCount = symbols.length;
    run.logs.push(`[UNIVERSE] ${symbols.length}/${originallySelected} symbols have complete ${run.testPeriodDays}-day history; ${skippedSymbols.length} excluded: ${skippedSymbols.join(', ') || 'none'}.`);
    storageService.saveBacktestRun(run);

    if (candleMap.size === 0) {
      throw new Error(`Failed to retrieve historical market data for symbols in group on ${portfolioConfig.exchange}.`);
    }

    // 3. Identify common timeline
    let minTime = Infinity;
    let maxTime = -Infinity;
    candleMap.forEach((candles) => {
      if (candles.length > 0) {
        if (candles[0].time < minTime) minTime = candles[0].time;
        if (candles[candles.length - 1].time > maxTime) maxTime = candles[candles.length - 1].time;
      }
    });

    const timeline: number[] = [];
    for (let t = minTime; t <= maxTime; t += stepSec) {
      timeline.push(t);
    }
    run.startDate = new Date(minTime * 1000).toISOString().slice(0, 10);
    run.endDate = new Date(maxTime * 1000).toISOString().slice(0, 10);
    run.logs.push(`[DATA] Simulation uses actual ${run.startDate} through ${run.endDate} candles (requested ${run.testPeriodDays} days).`);

    // Fast candle index lookup
    const candleIndexMap = new Map<string, Map<number, OHLCV>>();
    candleMap.forEach((candles, sym) => {
      const m = new Map<number, OHLCV>();
      candles.forEach((c) => m.set(c.time, c));
      candleIndexMap.set(sym, m);
    });

    run.logs.push(`Simulation timeline initialized with ${timeline.length} bars.`);

    const fundingHistory = new Map<string, FundingEvent[]>();
    const fundingCursor = new Map<string, number>();
    if (portfolioConfig.exchange === 'bybit') {
      let fundingIndex = 0;
      let loadedFundingCount = 0;
      let fundingError: Error | null = null;
      const loadFundingWorker = async () => {
        while (!job.stopped && !fundingError) {
        const sym = symbols[fundingIndex++];
        if (!sym) return;
        job.currentDate = `Funding history ${loadedFundingCount}/${symbols.length}`;
        let history: FundingEvent[];
        try {
          // Funding settled at or before the last bar's close can apply.
          history = await exchangeService.getBybitFundingHistory(sym, minTime, maxTime + stepSec);
        } catch (error: any) {
          fundingError = new Error(`Funding history for ${sym}: ${error.message}`);
          return;
        }
        fundingHistory.set(sym, history);
        fundingCursor.set(sym, 0);
        const maxAbs = history.reduce((m, e) => Math.max(m, Math.abs(e.rate)), 0);
        run.logs.push(`[FUNDING] ${sym}: ${history.length} actual historical Bybit funding settlements loaded (max |rate| ${(maxAbs * 100).toFixed(4)}%); prior candle close approximates settlement mark price.`);
        loadedFundingCount++;
        job.progress = 25 + Math.floor((loadedFundingCount / symbols.length) * 15);
        job.currentDate = `Funding loaded ${loadedFundingCount}/${symbols.length}`;
        if (loadedFundingCount % 10 === 0) storageService.saveBacktestRun(run);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, () => loadFundingWorker()));
      if (job.stopped) return;
      if (fundingError) throw fundingError;
    } else {
      run.logs.push(`[FUNDING] Historical funding API not implemented for ${portfolioConfig.exchange}; fixed ${portfolioConfig.fundingRate8hPct}% every 8h charged to every position is a model assumption, not exchange history.`);
    }

    // 4. State variables
    let accountBalance = portfolioConfig.initialCapital;
    let peakPortfolioEquity = accountBalance;
    let maxDrawdownPct = 0;
    let totalFeesPaid = 0;
    let totalFundingPaid = 0;
    let fundingEventsApplied = 0;
    let equityDepletedLogged = false;
    // Per-bar equity returns for an actual (annualised) Sharpe ratio.
    let previousBarEquity = accountBalance;
    let returnCount = 0;
    let returnMean = 0;
    let returnM2 = 0;

    let cycleIndex = 1;
    let cycleStartEquity = accountBalance;
    // An idle cycle has no start date. Its clock begins only when the first
    // position actually opens, not at the beginning of historical data.
    let cycleStartTime: number | null = null;
    let cyclePeakProfitPct = 0; // relative to cycleStartEquity
    let cycleExpiredWaitingBreakeven = false; // Defect fix: hold losing cycle until breakeven

    let openPositions: PositionTrade[] = [];
    const fundingExcludedSymbols = new Set<string>();
    const maxFundingCostPct = Number.isFinite(portfolioConfig.maxFundingCostPct)
      ? Math.max(0.1, Number(portfolioConfig.maxFundingCostPct)) : 5;
    const closedTrades: PositionTrade[] = [];
    const completedCycles: CycleRecord[] = [];
    const equityCurve: EquityPoint[] = [];

    // Next-candle queued entries (signal on bar N close -> execute at bar N+1 open)
    interface QueuedSignal {
      symbol: string;
      side: 'BUY' | 'SELL';
      adx: number;
      rsi: number;
      signalTime: number;
      reason: string;
    }
    let queuedEntries: QueuedSignal[] = [];

    const cycleDurationDays = Math.max(1, portfolioConfig.cycleToDay);
    let lastFundingTime = timeline[0];
    const feeRate = portfolioConfig.feeTakerPct / 100;

    // Helper: find applicable PnL drop rule based on peak profit percentage
    const getActiveDropRule = (peakProfitPct: number) => {
      const match = pnlConfig.rules.find((r) => peakProfitPct >= r.fromPct && peakProfitPct <= r.toPct);
      if (match) return match;
      const sorted = [...pnlConfig.rules].sort((a, b) => b.toPct - a.toPct);
      if (sorted.length > 0 && peakProfitPct > sorted[0].toPct) {
        return sorted[0];
      }
      return null;
    };

    // Last close seen for each symbol (used when a symbol has a missing bar).
    const lastClose = new Map<string, number>();
    const lastKnownClose = (sym: string, _time: number) => lastClose.get(sym);
    let marginSkips = 0;

    const markPnl = (pos: PositionTrade, price: number) =>
      pos.notional * (pos.side === 'BUY' ? price - pos.entryPrice : pos.entryPrice - price) / pos.entryPrice;

    // Helper: close a trade at an executable (slipped) market price.
    const closeTrade = (trade: PositionTrade, markPrice: number, exitTime: number, reason: ExitReason) => {
      const exitPrice = calculateExecutedExitPrice(markPrice, trade.side, portfolioConfig.slippageTolerance);
      trade.exitPrice = exitPrice;
      trade.exitTime = exitTime;
      trade.status = 'CLOSED';
      trade.exitReason = reason;

      const grossPnl = markPnl(trade, exitPrice);
      // Taker fee is charged on the exit order's value (quantity x exit price).
      const exitFee = trade.notional * (exitPrice / trade.entryPrice) * feeRate;
      // Entry fee and funding were already debited from the balance when they
      // occurred; realised trade PnL reports every cost of the round trip.
      const netPnl = grossPnl - trade.feePaid - exitFee - trade.fundingPaid;

      trade.grossPnlUsdt = Number(grossPnl.toFixed(6));
      trade.pnlUsdt = Number(netPnl.toFixed(4));
      trade.pnlPct = Number(((netPnl / trade.margin) * 100).toFixed(2));
      trade.feePaid += exitFee;
      totalFeesPaid += exitFee;

      accountBalance += grossPnl - exitFee;
      closedTrades.push(trade);
    };

    // Helper: liquidate entire basket
    const liquidateBasket = (curTime: number, reason: ExitReason, exitFloorPct: number, activeRule?: any) => {
      for (const pos of openPositions) {
        const c = candleIndexMap.get(pos.symbol)?.get(curTime);
        const markPrice = c ? c.close : lastKnownClose(pos.symbol, curTime) ?? pos.entryPrice;
        closeTrade(pos, markPrice, curTime, reason);
      }
      openPositions = [];
      queuedEntries = [];

      // Record completed cycle
      const completedCycle: CycleRecord = {
        cycleIndex,
        startTime: cycleStartTime ?? curTime,
        endTime: curTime,
        startEquity: Number(cycleStartEquity.toFixed(2)),
        endEquity: Number(accountBalance.toFixed(2)),
        peakProfitPct: Number(cyclePeakProfitPct.toFixed(2)),
        exitFloorPct: Number(exitFloorPct.toFixed(2)),
        activeRule: activeRule || undefined,
        exitReason: reason,
        tradesCount: closedTrades.filter((t) => t.cycleIndex === cycleIndex).length,
        realizedPnl: Number((accountBalance - cycleStartEquity).toFixed(2))
      };
      completedCycles.push(completedCycle);

      run.logs.push(
        `[${job.currentDate}] Cycle #${cycleIndex} ended (${reason}). Peak: +${cyclePeakProfitPct.toFixed(1)}%, Floor: +${exitFloorPct.toFixed(1)}%, Realized: $${completedCycle.realizedPnl}. Starting Cycle #${cycleIndex + 1}.`
      );

      // Reset for next cycle
      cycleIndex++;
      cycleStartEquity = accountBalance;
      cycleStartTime = null;
      cyclePeakProfitPct = 0;
      cycleExpiredWaitingBreakeven = false;
    };

    let lastProcessedTime = timeline[0];
    let lastYield = Date.now();

    // 5. Main Time Loop
    for (let barIdx = 0; barIdx < timeline.length; barIdx++) {
      // Yield to the event loop regularly: a 1-year multi-symbol simulation
      // otherwise blocks the whole server (chart API, status polling) and a
      // Stop request cannot be processed until the run has finished.
      if (Date.now() - lastYield > 40) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        lastYield = Date.now();
      }
      if (job.stopped) break;

      const curTime = timeline[barIdx];
      lastProcessedTime = curTime;
      const progress = 40 + Math.min(59, Math.floor((barIdx / Math.max(1, timeline.length)) * 59));
      job.progress = progress;
      job.currentDate = new Date(curTime * 1000).toISOString().replace('T', ' ').slice(0, 16);
      job.openPositionsCount = openPositions.length;

      // ─── A. EXECUTE QUEUED ENTRIES FROM CANDLE N CLOSE AT THIS CANDLE N+1 OPEN ───
      if (queuedEntries.length > 0 && !cycleExpiredWaitingBreakeven) {
        // Cross margin: free margin = wallet balance + unrealised PnL (marked
        // at this bar's open, known at execution time) - initial margin in use.
        let unrealizedAtOpen = 0;
        let usedMargin = 0;
        for (const pos of openPositions) {
          const price = candleIndexMap.get(pos.symbol)?.get(curTime)?.open ?? lastKnownClose(pos.symbol, curTime) ?? pos.entryPrice;
          unrealizedAtOpen += markPnl(pos, price);
          usedMargin += pos.margin;
        }
        for (const queued of queuedEntries) {
          if (openPositions.length >= portfolioConfig.maxOpenPositions) break;
          if (fundingExcludedSymbols.has(queued.symbol)) continue;
          if (openPositions.some((p) => p.symbol === queued.symbol)) continue;

          const c = candleIndexMap.get(queued.symbol)?.get(curTime);
          if (!c) continue;

          const exchangeMax = maxLeverageBySymbol.get(queued.symbol);
          const appliedLeverage = portfolioConfig.useMaxLeverage
            ? exchangeMax!
            : Math.min(portfolioConfig.manualLeverage, exchangeMax ?? portfolioConfig.manualLeverage);

          const notional = portfolioConfig.positionSizeNotional;
          const initialMargin = notional / appliedLeverage;
          const entryFee = notional * feeRate;
          const freeMargin = accountBalance + unrealizedAtOpen - usedMargin;

          if (freeMargin >= initialMargin + entryFee) {
            const executedPrice = calculateExecutedEntryPrice(c.open, queued.side, portfolioConfig.slippageTolerance);

            accountBalance -= entryFee; // Deduct taker fee on entry
            totalFeesPaid += entryFee;
            usedMargin += initialMargin;

            const newTrade: PositionTrade = {
              id: `T-${closedTrades.length + openPositions.length + 1}`,
              symbol: queued.symbol,
              side: queued.side,
              entryTime: curTime,
              // NEVER quantize synthetic execution to 2 decimals: a $0.038
              // perpetual would become $0.04, distorting PnL by >5%.
              // Keep the exact next-bar open plus simulated slippage.
              entryPrice: executedPrice,
              notional,
              leverage: appliedLeverage,
              margin: Number(initialMargin.toFixed(6)),
              pnlUsdt: 0,
              pnlPct: 0,
              feePaid: entryFee,
              fundingPaid: 0,
              status: 'OPEN',
              cycleIndex,
              adxAtEntry: Number(queued.adx.toFixed(1)),
              rsiAtEntry: Number(queued.rsi.toFixed(1)),
              entrySignalTime: queued.signalTime,
              entrySignalReason: queued.reason
            };
            // Slippage makes the fill worse than the open; mark it immediately.
            unrealizedAtOpen += markPnl(newTrade, c.open);

            openPositions.push(newTrade);
            if (cycleStartTime === null) {
              cycleStartTime = curTime;
              cycleStartEquity = accountBalance + entryFee;
              run.logs.push(`[${job.currentDate}] Cycle #${cycleIndex} started with first position ${queued.symbol}.`);
            }
          } else {
            marginSkips++;
            if (marginSkips <= 20) {
              run.logs.push(`[${job.currentDate}] ${queued.symbol} ${queued.side} skipped: free cross margin $${freeMargin.toFixed(4)} < required $${(initialMargin + entryFee).toFixed(4)}.`);
            }
          }
        }
        queuedEntries = [];
      }

      // ─── B. FUNDING SETTLEMENTS ───
      if (portfolioConfig.exchange === 'bybit') {
        for (const sym of symbols) {
          const history = fundingHistory.get(sym) || [];
          let cursor = fundingCursor.get(sym) || 0;
          while (cursor < history.length && history[cursor].time <= curTime) {
            const event = history[cursor++];
            for (const pos of openPositions) {
              if (pos.symbol !== sym || pos.entryTime >= event.time) continue;
              const priorClose = candleIndexMap.get(sym)?.get(curTime - stepSec)?.close || lastKnownClose(sym, curTime) || pos.entryPrice;
              const markedNotional = pos.notional * priorClose / pos.entryPrice;
              // Positive rate: longs pay shorts. Negative rate: shorts pay longs.
              const signedFee = markedNotional * event.rate * (pos.side === 'BUY' ? 1 : -1);
              accountBalance -= signedFee;
              pos.fundingPaid += signedFee;
              totalFundingPaid += signedFee;
              fundingEventsApplied++;
            }
          }
          fundingCursor.set(sym, cursor);
        }
      } else if (portfolioConfig.fundingRate8hPct > 0 && curTime - lastFundingTime >= 28800) {
        lastFundingTime = curTime;
        for (const pos of openPositions) {
          const fundingFee = pos.notional * (portfolioConfig.fundingRate8hPct / 100);
          accountBalance -= fundingFee;
          pos.fundingPaid += fundingFee;
          totalFundingPaid += fundingFee;
          fundingEventsApplied++;
        }
      }

      // Emergency per-contract funding exit. Paid funding is already debited
      // from cash above; closing realizes price PnL and the exit fee only.
      // Affected symbols are not re-entered during this backtest, even if a
      // later BUY/SELL indicator signal appears or the basket stays in loss.
      const fundingExitPositions = openPositions.filter((pos) =>
        pos.fundingPaid > 0 && pos.fundingPaid >= pos.notional * maxFundingCostPct / 100
      );
      if (fundingExitPositions.length > 0) {
        const exiting = new Set(fundingExitPositions.map((pos) => pos.id));
        for (const pos of fundingExitPositions) {
          const exitPrice = candleIndexMap.get(pos.symbol)?.get(curTime)?.close;
          if (!exitPrice || exitPrice <= 0) {
            throw new Error(`Funding emergency exit requires a real candle price for ${pos.symbol} at ${curTime}`);
          }
          closeTrade(pos, exitPrice, curTime, 'FUNDING_EXIT');
          fundingExcludedSymbols.add(pos.symbol);
          run.logs.push(`[${job.currentDate}] [FUNDING EXIT] ${pos.symbol} ${pos.side}: paid funding ${pos.fundingPaid.toFixed(4)} reached ${maxFundingCostPct}% of ${pos.notional} entry notional; closed at ${pos.exitPrice} (mark ${exitPrice} incl. slippage) even if losing; excluded from further entries.`);
        }
        openPositions = openPositions.filter((pos) => !exiting.has(pos.id));
        queuedEntries = queuedEntries.filter((entry) => !fundingExcludedSymbols.has(entry.symbol));
      }

      // ─── C. MARK-TO-MARKET UNREALIZED PNL & TOTAL EQUITY ───
      for (const sym of symbols) {
        const c = candleIndexMap.get(sym)?.get(curTime);
        if (c) lastClose.set(sym, c.close);
      }
      let currentUnrealizedPnl = 0;
      for (const pos of openPositions) {
        const c = candleIndexMap.get(pos.symbol)?.get(curTime);
        const curPrice = c ? c.close : lastKnownClose(pos.symbol, curTime) ?? pos.entryPrice;
        currentUnrealizedPnl += markPnl(pos, curPrice);
      }

      let totalEquity = accountBalance + currentUnrealizedPnl;

      // Update portfolio peak equity and drawdown
      if (totalEquity > peakPortfolioEquity) {
        peakPortfolioEquity = totalEquity;
      }
      let curDrawdownPct =
        peakPortfolioEquity > 0 ? ((peakPortfolioEquity - totalEquity) / peakPortfolioEquity) * 100 : 0;
      if (curDrawdownPct > maxDrawdownPct) {
        maxDrawdownPct = curDrawdownPct;
      }
      if (totalEquity <= 0 && !equityDepletedLogged) {
        equityDepletedLogged = true;
        run.logs.push(`[WARNING ${job.currentDate}] Account equity reached $${totalEquity.toFixed(2)}. A real exchange would have liquidated this cross-margin account; the simulation does not model liquidation.`);
      }

      // Check account-wide liquidation or Max Drawdown cutoff
      if (portfolioConfig.maxDrawdownCutoff > 0 && curDrawdownPct >= portfolioConfig.maxDrawdownCutoff) {
        liquidateBasket(curTime, 'MAX_DRAWDOWN', 0);
        run.logs.push(`[${job.currentDate}] Max Drawdown Cutoff hit (${curDrawdownPct.toFixed(1)}%). Closed all positions.`);
        break;
      }

      // ─── D. CYCLE BASKET ACCOUNTING & 5-STAGE PNL DROP RULE ───
      const cycleNetProfitUsdt = totalEquity - cycleStartEquity;
      const cycleNetProfitPct = cycleStartEquity > 0 ? (cycleNetProfitUsdt / cycleStartEquity) * 100 : 0;

      if (cycleNetProfitPct > cyclePeakProfitPct) {
        cyclePeakProfitPct = cycleNetProfitPct;
      }

      // Determine active rule and exit floor
      const activeRule = getActiveDropRule(cyclePeakProfitPct);
      let exitFloorPct = -Infinity;
      let shouldLiquidateBasket = false;
      let basketExitReason: ExitReason = 'PNL_DROP_FLOOR';

      if (pnlConfig.fixedFloorEnabled && cyclePeakProfitPct >= pnlConfig.fixedFloorTriggerPct) {
        exitFloorPct = pnlConfig.fixedFloorLockPct;
        if (cycleNetProfitPct <= exitFloorPct) {
          shouldLiquidateBasket = true;
          basketExitReason = 'PNL_DROP_FLOOR';
        }
      } else if (activeRule) {
        // Exit Floor = Peak Profit * (1 - Profit Drop / 100)
        exitFloorPct = cyclePeakProfitPct * (1 - activeRule.dropPct / 100);
        if (cycleNetProfitPct <= exitFloorPct) {
          shouldLiquidateBasket = true;
          basketExitReason = 'PNL_DROP_FLOOR';
        }
      }

      // ─── E. CYCLE DURATION EXPIRY & BREAKEVEN HOLDING RULE ───
      if (hasCycleReachedExpiry(cycleStartTime, curTime, cycleDurationDays, openPositions.length > 0) && !shouldLiquidateBasket) {
        if (cycleNetProfitUsdt >= 0) {
          // Basket is in profit or breakeven -> liquidate and start next cycle
          shouldLiquidateBasket = true;
          basketExitReason = 'CYCLE_EXPIRY';
        } else {
          // Cycle duration expired, but basket is currently losing:
          // CRITICAL DEFECT FIX: DO NOT CLOSE on expiry day!
          // Freeze new entries and hold open positions until basket recovers to breakeven or profit.
          if (!cycleExpiredWaitingBreakeven) {
            cycleExpiredWaitingBreakeven = true;
            run.logs.push(
              `[${job.currentDate}] Cycle #${cycleIndex} duration elapsed (${cycleDurationDays}d) with negative PnL ($${cycleNetProfitUsdt.toFixed(2)}). Holding positions and freezing new entries until breakeven.`
            );
          }
        }
      }

      // If waiting for breakeven after expiry, check if recovered to >= 0
      if (cycleExpiredWaitingBreakeven && cycleNetProfitUsdt >= 0 && openPositions.length > 0) {
        shouldLiquidateBasket = true;
        basketExitReason = 'CYCLE_EXPIRY';
        run.logs.push(
          `[${job.currentDate}] Cycle #${cycleIndex} recovered to breakeven/profit ($${cycleNetProfitUsdt.toFixed(2)}) after expiry. Liquidating basket.`
        );
      }

      // Execute basket liquidation if triggered
      if (shouldLiquidateBasket && openPositions.length > 0) {
        liquidateBasket(curTime, basketExitReason, exitFloorPct > -100 ? exitFloorPct : 0, activeRule);
        // Exit slippage and fees are real costs of this bar.
        currentUnrealizedPnl = 0;
        totalEquity = accountBalance;
        curDrawdownPct = peakPortfolioEquity > 0 ? ((peakPortfolioEquity - totalEquity) / peakPortfolioEquity) * 100 : 0;
        if (curDrawdownPct > maxDrawdownPct) maxDrawdownPct = curDrawdownPct;
      }

      // Per-bar return statistics (Welford) for the Sharpe ratio.
      if (barIdx > 0 && previousBarEquity > 0) {
        const r = totalEquity / previousBarEquity - 1;
        returnCount++;
        const delta = r - returnMean;
        returnMean += delta / returnCount;
        returnM2 += delta * (r - returnMean);
      }
      previousBarEquity = totalEquity;

      // Record equity curve point every 6 bars or on last bar
      if (barIdx % 6 === 0 || barIdx === timeline.length - 1) {
        equityCurve.push({
          time: curTime,
          equity: Number(totalEquity.toFixed(2)),
          balance: Number(accountBalance.toFixed(2)),
          unrealizedPnl: Number(currentUnrealizedPnl.toFixed(2)),
          peakEquity: Number(peakPortfolioEquity.toFixed(2)),
          drawdownPct: Number(curDrawdownPct.toFixed(2)),
          openPositionsCount: openPositions.length,
          cycleIndex,
          activeFloorPct: exitFloorPct > -100 ? Number(exitFloorPct.toFixed(1)) : undefined
        });
      }

      // ─── F. EVALUATE INDICATOR SIGNALS FOR ENTRY AT CANDLE N+1 OPEN ───
      // If cycle is expired and waiting for breakeven, new entries are frozen!
      if (!cycleExpiredWaitingBreakeven) {
        interface CandidateSignal {
          symbol: string;
          side: 'BUY' | 'SELL';
          adx: number;
          rsi: number;
          signalTime: number;
          reason: string;
        }
        const candidateSignals: CandidateSignal[] = [];

        for (const sym of symbols) {
          // Skip if symbol already has an open position (one position per symbol)
          if (openPositions.some((p) => p.symbol === sym)) continue;
          if (fundingExcludedSymbols.has(sym)) continue;

          const sigs = signalMap.get(sym);
          if (!sigs) continue;

          const hasBuy = sigs.buyMap.has(curTime);
          const hasSell = sigs.sellMap.has(curTime);
          const currentAdx = sigs.adxMap.get(curTime) ?? 0;
          const currentRsi = sigs.rsiMap.get(curTime) ?? 50;

          if (hasBuy && portfolioConfig.signalSide !== 'sell') {
            candidateSignals.push({ symbol: sym, side: 'BUY', adx: currentAdx, rsi: currentRsi, signalTime: curTime, reason: sigs.buyMap.get(curTime)!.reason });
          } else if (hasSell && portfolioConfig.signalSide !== 'buy') {
            candidateSignals.push({ symbol: sym, side: 'SELL', adx: currentAdx, rsi: currentRsi, signalTime: curTime, reason: sigs.sellMap.get(curTime)!.reason });
          }
        }

        if (candidateSignals.length > 0) {
          // Deterministic prioritization: highest ADX trend strength, tie-breaker RSI
          candidateSignals.sort((a, b) => {
            if (b.adx !== a.adx) return b.adx - a.adx;
            if (a.side === 'BUY') return a.rsi - b.rsi;
            return b.rsi - a.rsi;
          });

          // Queue candidate signals for next candle open (up to capacity)
          const availableSlots = portfolioConfig.maxOpenPositions - openPositions.length;
          queuedEntries = candidateSignals.slice(0, Math.max(0, availableSlots));
        }
      }
    }

    // 6. Mark remaining positions to market. The historical window ending is
    // NOT an order to liquidate a losing cycle awaiting breakeven.
    const finalTime = lastProcessedTime;
    const unrealizedPnl = markOpenPositionsAtEnd(openPositions, (symbol) =>
      candleIndexMap.get(symbol)?.get(finalTime)?.close ?? lastClose.get(symbol));
    if (openPositions.length > 0) {
      run.logs.push(`Backtest window ended with ${openPositions.length} OPEN position(s), unrealized PnL $${unrealizedPnl.toFixed(2)}. No forced exit; cycle #${cycleIndex} remains incomplete.`);
    }

    // 7. Metrics & Reporting
    const finalEquity = accountBalance + unrealizedPnl;
    const netPnl = Number((finalEquity - portfolioConfig.initialCapital).toFixed(2));
    const roiPct = Number(((netPnl / portfolioConfig.initialCapital) * 100).toFixed(2));
    const winningTrades = closedTrades.filter((t) => t.pnlUsdt > 0);
    const losingTrades = closedTrades.filter((t) => t.pnlUsdt <= 0);
    const winRate = closedTrades.length > 0 ? Number(((winningTrades.length / closedTrades.length) * 100).toFixed(1)) : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlUsdt, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlUsdt, 0));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 1;

    // Annualised Sharpe ratio of per-bar equity returns (risk-free rate 0).
    const barsPerYear = (365 * 1440) / portfolioConfig.backtestTimeframe;
    const returnStd = returnCount > 1 ? Math.sqrt(returnM2 / (returnCount - 1)) : 0;
    const sharpeRatio = returnStd > 0 ? (returnMean / returnStd) * Math.sqrt(barsPerYear) : 0;

    const durationSec = Math.max(1, Math.floor((Date.now() - startTime) / 1000));

    const wasStopped = job.stopped;
    run.status = wasStopped ? 'STOPPED' : 'COMPLETED';
    run.finalBalance = Number(finalEquity.toFixed(2));
    run.cashBalance = Number(accountBalance.toFixed(2));
    run.unrealizedPnl = Number(unrealizedPnl.toFixed(2));
    run.openPositionsCount = openPositions.length;
    run.netPnl = netPnl;
    run.roiPct = roiPct;
    run.winRate = winRate;
    run.profitFactor = profitFactor;
    run.maxDrawdownPct = Number(maxDrawdownPct.toFixed(1));
    run.sharpeRatio = Number(sharpeRatio.toFixed(2));
    run.totalTrades = closedTrades.length;
    run.winningTrades = winningTrades.length;
    run.losingTrades = losingTrades.length;
    run.completedCycles = completedCycles.length;
    run.durationSec = durationSec;
    run.totalFeesPaid = Number(totalFeesPaid.toFixed(4));
    run.totalFundingPaid = Number(totalFundingPaid.toFixed(4));
    run.trades = [...closedTrades, ...openPositions];
    run.cycles = completedCycles;
    run.equityCurve = equityCurve;

    run.logs.push(
      `[COSTS] Trading fees $${totalFeesPaid.toFixed(4)}; net funding ${totalFundingPaid >= 0 ? 'paid' : 'received'} $${Math.abs(totalFundingPaid).toFixed(4)} across ${fundingEventsApplied} position-settlements.`
    );
    if (marginSkips > 0) run.logs.push(`[MARGIN] ${marginSkips} signal(s) skipped for insufficient free cross margin.`);
    if (wasStopped) {
      run.endDate = new Date(lastProcessedTime * 1000).toISOString().slice(0, 10);
      run.logs.push(`Backtest STOPPED by user at ${new Date(lastProcessedTime * 1000).toISOString()}; metrics cover the partial window only.`);
    }
    run.logs.push(
      `Backtest finalized in ${durationSec}s. Net PnL: $${netPnl} (${roiPct > 0 ? '+' : ''}${roiPct}%), Win Rate: ${winRate}%, Profit Factor: ${profitFactor}, Max DD: -${maxDrawdownPct.toFixed(1)}%, Sharpe (annualised): ${run.sharpeRatio}.`
    );

    job.progress = 100;
    storageService.saveBacktestRun(run);
  }
}

export const backtestService = new BacktestService();
