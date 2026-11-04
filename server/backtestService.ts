/**
 * Full Backtesting Engine for KEYS Strategy Lab
 * Simulates multi-symbol crypto perpetual futures portfolios across time
 */
import {
  BacktestRun,
  PortfolioConfig,
  PnLConfig,
  PositionTrade,
  CycleRecord,
  EquityPoint,
  ExitReason,
  OHLCV,
  SymbolMeta
} from '../src/types';
import { exchangeService } from './exchanges';
import { storageService } from './storage';
import { calculateKeysIndicator } from '../src/engine/indicatorCalculations';
import { markOpenPositionsAtEnd } from '../src/engine/openPositionValuation';
import { calculateExecutedEntryPrice } from '../src/engine/executionPrice';
import { ORIGINAL_KEYS_PINE_SCRIPT } from '../src/engine/defaultPineScripts';
import { hasCycleReachedExpiry } from '../src/engine/cycleTiming';

export interface ActiveJob {
  run: BacktestRun;
  stopped: boolean;
  progress: number; // 0 - 100
  currentDate?: string;
  openPositionsCount: number;
}

export class BacktestService {
  private activeJobs: Map<string, ActiveJob> = new Map();

  getActiveJob(id: string): ActiveJob | undefined {
    return this.activeJobs.get(id);
  }

  stopJob(id: string): boolean {
    const job = this.activeJobs.get(id);
    if (job) {
      job.stopped = true;
      job.run.status = 'STOPPED';
      storageService.saveBacktestRun(job.run);
      return true;
    }
    return false;
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
    const runId = `BT-${Math.floor(1000 + Math.random() * 9000)}`;

    // Resolve symbol group
    const groups = storageService.getGroups();
    const group = groups.find((g) => g.id === portfolioConfig.savedGroupId);
    if (!group || group.symbols.length === 0) throw new Error('Select a saved group containing at least one symbol.');
    if (group.exchange !== portfolioConfig.exchange) throw new Error('Selected group exchange does not match the test exchange.');
    const indicator = storageService.getIndicators().find((i) => i.id === indicatorId);
    if (indicatorId !== 'keys_v6' || !indicator || indicator.code.trim() !== ORIGINAL_KEYS_PINE_SCRIPT.trim()) {
      throw new Error('This Pine Script is not supported by the executable backtest engine. Select the original KEYS Liquidity Trap & SAR indicator; arbitrary Pine scripts are not executed.');
    }
    // Persist and execute the exact same parameter snapshot. Omitted inputs
    // inherit the saved indicator profile, never an unrelated hardcoded value.
    const effectiveParams = {
      ...Object.fromEntries(indicator.params.map((param) => [param.name, param.value])),
      ...indicatorParams
    };
    if (typeof effectiveParams.useSARFilter !== 'boolean') {
      throw new Error('Enable SAR Filter must be a boolean; refresh the indicator settings and retry.');
    }
    const testPeriodDays = Number(portfolioConfig.testPeriodDays || 30);
    if (![30, 90, 180, 365].includes(testPeriodDays)) throw new Error('Historical test period must be 30, 90, 180, or 365 days.');
    const symbols = group.symbols;

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
        `[INDICATOR] KEYS v6 parameter snapshot: ${JSON.stringify(effectiveParams)}`
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
    this.executeSimulation(job, symbols, portfolioConfig, pnlConfig, effectiveParams).catch((err) => {
      console.error(`Backtest ${runId} error:`, err);
      job.run.status = 'FAILED';
      job.run.error = err.message;
      storageService.saveBacktestRun(job.run);
    });

    return runId;
  }

  private async executeSimulation(
    job: ActiveJob,
    symbols: string[],
    portfolioConfig: PortfolioConfig,
    pnlConfig: PnLConfig,
    indicatorParams: Record<string, any>
  ): Promise<void> {
    const run = job.run;
    const startTime = Date.now();

    const symbolMetaMap = new Map<string, SymbolMeta>();

    // 1. Validate manual leverage against exchange contract tier limits
    for (const sym of symbols) {
      const meta = exchangeService.getSymbolMeta(portfolioConfig.exchange, sym);
      if (meta) {
        symbolMetaMap.set(sym, meta);
        if (!portfolioConfig.useMaxLeverage && portfolioConfig.manualLeverage > meta.maxLeverage) {
          throw new Error(
            `Manual leverage ${portfolioConfig.manualLeverage}x exceeds maximum contract leverage of ${meta.maxLeverage}x for ${sym} on ${portfolioConfig.exchange}.`
          );
        }
      }
    }

    // 2. Fetch OHLCV candles and compute indicator signals for all symbols
    run.logs.push(`Loading market candles for ${symbols.length} perpetual contracts on ${portfolioConfig.exchange}...`);
    const candleMap = new Map<string, OHLCV[]>();
    const signalMap = new Map<string, { buyMap: Map<number, { price: number; reason: string }>; sellMap: Map<number, { price: number; reason: string }>; adxMap: Map<number, number>; rsiMap: Map<number, number> }>();
    const requestedBars = Math.ceil((run.testPeriodDays * 1440) / portfolioConfig.backtestTimeframe);

    for (let symIdx = 0; symIdx < symbols.length; symIdx++) {
      if (job.stopped) return;
      const sym = symbols[symIdx];

      job.currentDate = `Loading ${sym} (${symIdx + 1}/${symbols.length})`;
      job.progress = Math.min(25, Math.max(1, Math.floor(((symIdx + 1) / symbols.length) * 25)));

      try {
        const candles = await exchangeService.getOHLCVCandles(
          portfolioConfig.exchange,
          sym,
          portfolioConfig.backtestTimeframe,
          requestedBars
        );
        if (candles.length < requestedBars - 2) {
          throw new Error(`Incomplete historical data for ${sym}: ${candles.length}/${requestedBars} candles; backtest cannot be marked completed.`);
        }
        run.logs.push(`[DATA] ${sym}: ${candles.length} verified ${portfolioConfig.backtestTimeframe}m candles, ${new Date(candles[0].time * 1000).toISOString()} to ${new Date(candles[candles.length - 1].time * 1000).toISOString()}`);
        candleMap.set(sym, candles);

        // Compute indicator signals
        const indicatorResult = calculateKeysIndicator(candles, indicatorParams);
        const buyMap = new Map<number, { price: number; reason: string }>();
        const sellMap = new Map<number, { price: number; reason: string }>();
        const adxMap = new Map<number, number>();
        const rsiMap = new Map<number, number>();

        indicatorResult.buySignals.forEach((s) => buyMap.set(s.time, { price: s.price, reason: s.reason || 'KEYS v6 BUY' }));
        indicatorResult.sellSignals.forEach((s) => sellMap.set(s.time, { price: s.price, reason: s.reason || 'KEYS v6 SELL' }));

        for (let i = 0; i < candles.length; i++) {
          const t = candles[i].time;
          if (indicatorResult.adxValues[i] !== null) adxMap.set(t, indicatorResult.adxValues[i]!);
          if (indicatorResult.rsiValues[i] !== null) rsiMap.set(t, indicatorResult.rsiValues[i]!);
        }

        signalMap.set(sym, { buyMap, sellMap, adxMap, rsiMap });
      } catch (err: any) {
        throw new Error(`Cannot run complete ${run.testPeriodDays}-day test: ${err.message}`);
      }
    }

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

    const stepSec = portfolioConfig.backtestTimeframe * 60;
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

    const fundingHistory = new Map<string, { time: number; rate: number }[]>();
    const fundingCursor = new Map<string, number>();
    if (portfolioConfig.exchange === 'bybit') {
      for (const sym of symbols) {
        if (job.stopped) return;
        const history = await exchangeService.getBybitFundingHistory(sym, minTime, maxTime);
        fundingHistory.set(sym, history);
        fundingCursor.set(sym, 0);
        run.logs.push(`[FUNDING] ${sym}: ${history.length} actual historical Bybit funding rates loaded; prior candle close approximates settlement mark price.`);
      }
    } else {
      run.logs.push(`[FUNDING] Historical funding API not implemented for ${portfolioConfig.exchange}; fixed ${portfolioConfig.fundingRate8hPct}% every 8h is a model assumption.`);
    }

    // 4. State variables
    let accountBalance = portfolioConfig.initialCapital;
    let peakPortfolioEquity = accountBalance;
    let maxDrawdownPct = 0;

    let cycleIndex = 1;
    let cycleStartEquity = accountBalance;
    // An idle cycle has no start date. Its clock begins only when the first
    // position actually opens, not at the beginning of historical data.
    let cycleStartTime: number | null = null;
    let cyclePeakProfitPct = 0; // relative to cycleStartEquity
    let cycleExpiredWaitingBreakeven = false; // Defect fix: hold losing cycle until breakeven

    let openPositions: PositionTrade[] = [];
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

    // Helper: close a trade
    const closeTrade = (trade: PositionTrade, exitPrice: number, exitTime: number, reason: ExitReason) => {
      trade.exitPrice = exitPrice;
      trade.exitTime = exitTime;
      trade.status = 'CLOSED';
      trade.exitReason = reason;

      const priceDiffPct =
        trade.side === 'BUY'
          ? (exitPrice - trade.entryPrice) / trade.entryPrice
          : (trade.entryPrice - exitPrice) / trade.entryPrice;

      // PnL in USDT based on total position notional
      const grossPnl = trade.notional * priceDiffPct;
      const takerFee = trade.notional * (portfolioConfig.feeTakerPct / 100);
      const netPnl = grossPnl - takerFee;

      trade.pnlUsdt = Number(netPnl.toFixed(4));
      trade.pnlPct = Number(((netPnl / trade.margin) * 100).toFixed(2));
      trade.feePaid += takerFee;

      accountBalance += netPnl;
      closedTrades.push(trade);
    };

    // Helper: liquidate entire basket
    const liquidateBasket = (curTime: number, reason: ExitReason, exitFloorPct: number, activeRule?: any) => {
      for (const pos of openPositions) {
        const c = candleIndexMap.get(pos.symbol)?.get(curTime);
        const exitP = c ? c.close : pos.entryPrice;
        closeTrade(pos, exitP, curTime, reason);
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

    // 5. Main Time Loop
    for (let barIdx = 0; barIdx < timeline.length; barIdx++) {
      if (job.stopped) break;

      const curTime = timeline[barIdx];
      const progress = 25 + Math.min(74, Math.floor((barIdx / Math.max(1, timeline.length)) * 74));
      job.progress = progress;
      job.currentDate = new Date(curTime * 1000).toISOString().replace('T', ' ').slice(0, 16);
      job.openPositionsCount = openPositions.length;

      // ─── A. EXECUTE QUEUED ENTRIES FROM CANDLE N CLOSE AT THIS CANDLE N+1 OPEN ───
      if (queuedEntries.length > 0 && !cycleExpiredWaitingBreakeven) {
        for (const queued of queuedEntries) {
          if (openPositions.length >= portfolioConfig.maxOpenPositions) break;
          if (openPositions.some((p) => p.symbol === queued.symbol)) continue;

          const c = candleIndexMap.get(queued.symbol)?.get(curTime);
          if (!c) continue;

          const meta = symbolMetaMap.get(queued.symbol);
          let appliedLeverage = portfolioConfig.manualLeverage;
          if (portfolioConfig.useMaxLeverage) {
            appliedLeverage = meta ? meta.maxLeverage : 50;
          } else {
            appliedLeverage = Math.min(portfolioConfig.manualLeverage, meta?.maxLeverage || 50);
          }

          const notional = portfolioConfig.positionSizeNotional;
          const initialMargin = notional / appliedLeverage;

          // Check margin availability
          if (accountBalance >= initialMargin) {
            const entryFee = notional * (portfolioConfig.feeTakerPct / 100);
            const executedPrice = calculateExecutedEntryPrice(c.open, queued.side, portfolioConfig.slippageTolerance);

            accountBalance -= entryFee; // Deduct taker fee on entry

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
              margin: Number(initialMargin.toFixed(4)),
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

            openPositions.push(newTrade);
            if (cycleStartTime === null) {
              cycleStartTime = curTime;
              cycleStartEquity = accountBalance + entryFee;
              run.logs.push(`[${job.currentDate}] Cycle #${cycleIndex} started with first position ${queued.symbol}.`);
            }
          }
        }
        queuedEntries = [];
      }

      // ─── B. FUNDING RATE DEDUCTION EVERY 8 HOURS ───
      if (portfolioConfig.exchange === 'bybit') {
        for (const sym of symbols) {
          const history = fundingHistory.get(sym) || [];
          let cursor = fundingCursor.get(sym) || 0;
          while (cursor < history.length && history[cursor].time <= curTime) {
            const event = history[cursor++];
            for (const pos of openPositions) {
              if (pos.symbol !== sym || pos.entryTime >= event.time) continue;
              const priorClose = candleIndexMap.get(sym)?.get(curTime - stepSec)?.close || pos.entryPrice;
              const markedNotional = pos.notional * priorClose / pos.entryPrice;
              const signedFee = markedNotional * event.rate * (pos.side === 'BUY' ? 1 : -1);
              accountBalance -= signedFee;
              pos.fundingPaid += signedFee;
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
        }
      }

      // ─── C. MARK-TO-MARKET UNREALIZED PNL & TOTAL EQUITY ───
      let currentUnrealizedPnl = 0;
      let usedMargin = 0;

      for (const pos of openPositions) {
        const c = candleIndexMap.get(pos.symbol)?.get(curTime);
        const curPrice = c ? c.close : pos.entryPrice;
        const diffPct =
          pos.side === 'BUY'
            ? (curPrice - pos.entryPrice) / pos.entryPrice
            : (pos.entryPrice - curPrice) / pos.entryPrice;
        const uPnl = pos.notional * diffPct;
        currentUnrealizedPnl += uPnl;
        usedMargin += pos.margin;
      }

      const totalEquity = accountBalance + currentUnrealizedPnl;

      // Update portfolio peak equity and drawdown
      if (totalEquity > peakPortfolioEquity) {
        peakPortfolioEquity = totalEquity;
      }
      const curDrawdownPct =
        peakPortfolioEquity > 0 ? ((peakPortfolioEquity - totalEquity) / peakPortfolioEquity) * 100 : 0;
      if (curDrawdownPct > maxDrawdownPct) {
        maxDrawdownPct = curDrawdownPct;
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
      }

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

          const sigs = signalMap.get(sym);
          if (!sigs) continue;

          const hasBuy = sigs.buyMap.has(curTime);
          const hasSell = sigs.sellMap.has(curTime);
          const currentAdx = sigs.adxMap.get(curTime) ?? 0;
          const currentRsi = sigs.rsiMap.get(curTime) ?? 50;

          if (hasBuy) {
            candidateSignals.push({ symbol: sym, side: 'BUY', adx: currentAdx, rsi: currentRsi, signalTime: curTime, reason: sigs.buyMap.get(curTime)!.reason });
          } else if (hasSell) {
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
    const finalTime = timeline[timeline.length - 1];
    const unrealizedPnl = markOpenPositionsAtEnd(openPositions, (symbol) => candleIndexMap.get(symbol)?.get(finalTime)?.close);
    if (openPositions.length > 0) {
      run.logs.push(`Backtest window ended with ${openPositions.length} OPEN position(s), unrealized PnL $${unrealizedPnl.toFixed(2)}. No forced exit; cycle #${cycleIndex} remains incomplete.`);
    }

    // 6. Metrics & Reporting
    const finalEquity = accountBalance + unrealizedPnl;
    const netPnl = Number((finalEquity - portfolioConfig.initialCapital).toFixed(2));
    const roiPct = Number(((netPnl / portfolioConfig.initialCapital) * 100).toFixed(2));
    const winningTrades = closedTrades.filter((t) => t.pnlUsdt > 0);
    const losingTrades = closedTrades.filter((t) => t.pnlUsdt <= 0);
    const winRate = closedTrades.length > 0 ? Number(((winningTrades.length / closedTrades.length) * 100).toFixed(1)) : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlUsdt, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlUsdt, 0));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 1;

    const durationSec = Math.max(1, Math.floor((Date.now() - startTime) / 1000));

    run.status = 'COMPLETED';
    run.finalBalance = Number(finalEquity.toFixed(2));
    run.cashBalance = Number(accountBalance.toFixed(2));
    run.unrealizedPnl = Number(unrealizedPnl.toFixed(2));
    run.openPositionsCount = openPositions.length;
    run.netPnl = netPnl;
    run.roiPct = roiPct;
    run.winRate = winRate;
    run.profitFactor = profitFactor;
    run.maxDrawdownPct = Number(maxDrawdownPct.toFixed(1));
    run.sharpeRatio = Number((roiPct / (Math.max(1, maxDrawdownPct) * 1.5)).toFixed(2));
    run.totalTrades = closedTrades.length;
    run.winningTrades = winningTrades.length;
    run.losingTrades = losingTrades.length;
    run.completedCycles = completedCycles.length;
    run.durationSec = durationSec;
    run.trades = [...closedTrades, ...openPositions];
    run.cycles = completedCycles;
    run.equityCurve = equityCurve;

    run.logs.push(
      `Backtest finalized in ${durationSec}s. Net PnL: $${netPnl} (${roiPct > 0 ? '+' : ''}${roiPct}%), Win Rate: ${winRate}%, Profit Factor: ${profitFactor}, Max DD: -${maxDrawdownPct.toFixed(1)}%.`
    );

    job.progress = 100;
    storageService.saveBacktestRun(run);
  }
}

export const backtestService = new BacktestService();
