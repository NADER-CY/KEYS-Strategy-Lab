import React, { useState, useEffect } from 'react';
import { CandlestickChart } from '../components/CandlestickChart';
import {
  PortfolioConfig,
  PnLConfig,
  PnLRuleRow,
  SavedSymbolGroup,
  SavedIndicator,
  OHLCV,
  IndicatorSignals,
  BacktestRun
} from '../types';
import { calculateKeysIndicator } from '../engine/indicatorCalculations';
import { parsePineScriptInputs, validatePineScript } from '../engine/defaultPineScripts';

interface ChartBacktestPageProps {
  activeStrategy: string;
  onStrategyChange: (strategy: string) => void;
  onSaveConfig?: () => Promise<void>;
  onLoadConfig?: () => void;
  onResetConfig?: () => void;
  portfolioConfig: PortfolioConfig;
  onUpdatePortfolioConfig: (cfg: PortfolioConfig) => void;
  pnlConfig: PnLConfig;
  onUpdatePnLConfig: (cfg: PnLConfig) => void;
  savedGroups: SavedSymbolGroup[];
  indicators: SavedIndicator[];
  activeIndicator: SavedIndicator;
  onSelectIndicator: (indicator: SavedIndicator) => void;
  onSaveIndicator: (indicator: SavedIndicator) => Promise<void> | void;
  onRunBacktest: (indicatorParams?: Record<string, any>) => void;
  onStopBacktest: () => void;
  isBacktestRunning: boolean;
  backtestProgress: number;
  currentDateProgress?: string;
  openPositionsCount: number;
  onNavigateToSymbols: () => void;
  initialSymbol?: string;
  lastCompletedRun?: BacktestRun | null;
  onNavigateToResults?: () => void;
  onNavigateToPage?: (page: 'chart' | 'results' | 'positions' | 'symbols') => void;
}

export const ChartBacktestPage: React.FC<ChartBacktestPageProps> = ({
  activeStrategy,
  onStrategyChange,
  onSaveConfig,
  onLoadConfig,
  onResetConfig,
  portfolioConfig,
  onUpdatePortfolioConfig,
  pnlConfig,
  onUpdatePnLConfig,
  savedGroups,
  indicators,
  activeIndicator,
  onSelectIndicator,
  onSaveIndicator,
  onRunBacktest,
  onStopBacktest,
  isBacktestRunning,
  backtestProgress,
  currentDateProgress,
  openPositionsCount,
  onNavigateToSymbols,
  initialSymbol,
  lastCompletedRun,
  onNavigateToResults,
  onNavigateToPage
}) => {
  // Active settings tab below the chart
  const [activeTab, setActiveTab] = useState<'strategy' | 'pnl' | 'indicator' | 'pinescript'>('strategy');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveSucceeded, setSaveSucceeded] = useState(false);

  const openSaveDialog = () => {
    setSaveMessage('');
    setSaveSucceeded(false);
    setShowSaveDialog(true);
  };
  const confirmSaveConfig = async () => {
    if (!onSaveConfig) return;
    setSavingConfig(true);
    setSaveMessage('');
    try {
      await onSaveConfig();
      setSaveSucceeded(true);
      setSaveMessage('Settings saved successfully on the server.');
    } catch (err: any) {
      setSaveSucceeded(false);
      setSaveMessage(`Save failed: ${err?.message || 'Unknown server error'}`);
    } finally {
      setSavingConfig(false);
    }
  };

  // Chart state
  const [currentSymbol, setCurrentSymbol] = useState<string>('BTCUSDT');
  const activeGroup = savedGroups.find((g) => g.id === portfolioConfig.savedGroupId) || savedGroups[0];
  const chartSymbolList = activeGroup?.symbols.length
    ? activeGroup.symbols
    : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT'];
  // A group switch can remove BTC from the selector. Never display BTC candles
  // beneath the browser's fallback first option (e.g. OGUSDT).
  const displayedSymbol = chartSymbolList.includes(currentSymbol) ? currentSymbol : chartSymbolList[0];
  const [chartTimeframe, setChartTimeframe] = useState<number>(5);
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [signals, setSignals] = useState<IndicatorSignals | undefined>(undefined);
  const [loadingChart, setLoadingChart] = useState<boolean>(false);
  const [isLiveActive, setIsLiveActive] = useState<boolean>(true);
  const [feedHealthy, setFeedHealthy] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Pine script editor state
  const [editorCode, setEditorCode] = useState<string>(activeIndicator.code);
  const [compileStatus, setCompileStatus] = useState<{ valid: boolean; message: string }>({
    valid: true,
    message: 'Compiled successfully (v6) • 14 inputs discovered'
  });

  // Local indicator params state for live tuning
  const [localParams, setLocalParams] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    activeIndicator.params.forEach((p) => {
      init[p.name] = p.value;
    });
    return init;
  });

  // Sync editor when active indicator changes
  useEffect(() => {
    setEditorCode(activeIndicator.code);
    const init: Record<string, any> = {};
    activeIndicator.params.forEach((p) => {
      init[p.name] = p.value;
    });
    setLocalParams(init);
  }, [activeIndicator.id]);

  // Sync symbol when initialSymbol prop changes
  useEffect(() => {
    if (initialSymbol && initialSymbol !== currentSymbol) {
      setCurrentSymbol(initialSymbol);
    }
  }, [initialSymbol]);

  useEffect(() => {
    if (displayedSymbol !== currentSymbol) setCurrentSymbol(displayedSymbol);
  }, [displayedSymbol, currentSymbol]);

  // Initial load when symbol or chart timeframe changes
  useEffect(() => {
    let isCancelled = false;
    setCandles([]);
    setSignals(undefined);
    setFeedHealthy(false);
    const fetchCandles = async () => {
      setLoadingChart(true);
      try {
        const res = await fetch(
          `/api/candles?exchange=${portfolioConfig.exchange}&symbol=${displayedSymbol}&timeframe=${chartTimeframe}&limit=400`
        );
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && Array.isArray(data)) {
            setCandles(data);
            const calculated = calculateKeysIndicator(data, localParams);
            setSignals(calculated);
            setLastRefreshedAt(new Date());
          }
        }
      } catch (err) {
        console.error('Error fetching candles:', err);
      } finally {
        if (!isCancelled) setLoadingChart(false);
      }
    };

    fetchCandles();
    return () => {
      isCancelled = true;
    };
  }, [displayedSymbol, chartTimeframe, portfolioConfig.exchange]);

  // Live real-time polling every 3.5 seconds
  useEffect(() => {
    if (!isLiveActive || isBacktestRunning) return;

    let isCancelled = false;
    let inFlight = false;
    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(
          `/api/candles?exchange=${portfolioConfig.exchange}&symbol=${displayedSymbol}&timeframe=${chartTimeframe}&limit=400&live=1`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && Array.isArray(data) && data.length > 0) {
            setCandles((previous) => {
              const a = previous[previous.length - 1];
              const b = data[data.length - 1];
              return previous.length === data.length && a?.time === b?.time && a?.close === b?.close && a?.high === b?.high && a?.low === b?.low && a?.volume === b?.volume ? previous : data;
            });
            setSignals(calculateKeysIndicator(data, localParams));
            setFeedHealthy(true);
            setLastRefreshedAt(new Date());
          }
        } else if (!isCancelled) setFeedHealthy(false);
      } catch {
        if (!isCancelled) setFeedHealthy(false);
      } finally {
        inFlight = false;
      }
    }, 3500);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [isLiveActive, isBacktestRunning, displayedSymbol, chartTimeframe, portfolioConfig.exchange, localParams]);

  // Manual refresh handler
  const handleManualRefresh = async () => {
    setLoadingChart(true);
    try {
      const res = await fetch(
        `/api/candles?exchange=${portfolioConfig.exchange}&symbol=${displayedSymbol}&timeframe=${chartTimeframe}&limit=400`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setCandles(data);
          const calculated = calculateKeysIndicator(data, localParams);
          setSignals(calculated);
          setLastRefreshedAt(new Date());
        }
      }
    } finally {
      setLoadingChart(false);
    }
  };

  // Re-apply indicator settings to chart
  const handleApplyToChart = () => {
    if (candles.length > 0) {
      const calculated = calculateKeysIndicator(candles, localParams);
      setSignals(calculated);
    }
  };

  // Save current tuning into indicator parameters
  const handleSaveIndicatorSettings = async () => {
    const updatedParams = activeIndicator.params.map((p) => ({
      ...p,
      value: localParams[p.name] !== undefined ? localParams[p.name] : p.value
    }));
    const updated: SavedIndicator = {
      ...activeIndicator,
      params: updatedParams,
      lastUpdated: new Date().toISOString()
    };
    try {
      await onSaveIndicator(updated);
      handleApplyToChart();
      alert('Indicator settings saved successfully. The next backtest will use these exact settings.');
    } catch (error: any) {
      alert(`Indicator settings were NOT saved: ${error?.message || 'Unknown error'}`);
    }
  };

  // Compile and validate Pine Script in editor
  const handleCompileScript = () => {
    const result = validatePineScript(editorCode);
    if (result.valid) {
      const inputs = parsePineScriptInputs(editorCode);
      setCompileStatus({
        valid: true,
        message: `Validated ${result.version} • ${inputs.length} configurable inputs discovered`
      });

      // Update indicator definition
      const updated: SavedIndicator = {
        ...activeIndicator,
        code: editorCode,
        version: result.version as any,
        validationStatus: 'Validated',
        params: inputs
      };
      onSaveIndicator(updated);

      const newParams: Record<string, any> = {};
      inputs.forEach((p) => {
        newParams[p.name] = p.value;
      });
      setLocalParams(newParams);

      if (candles.length > 0) {
        const calculated = calculateKeysIndicator(candles, newParams);
        setSignals(calculated);
      }
    } else {
      setCompileStatus({
        valid: false,
        message: result.error || 'Compilation syntax error'
      });
    }
  };

  // Active Symbol Group
  const groupSymbolsCount = activeGroup ? activeGroup.symbols.length : 0;

  // Calculate estimated initial margin
  const appliedLev = portfolioConfig.useMaxLeverage ? 50 : portfolioConfig.manualLeverage;
  const estimatedInitialMargin = (portfolioConfig.positionSizeNotional / appliedLev).toFixed(2);


  return (
    <div className="space-y-4 pb-8 animate-fadeIn">
      {/* Strategy controls belong to Chart & Backtest, not the global header. */}
      <section aria-label="Strategy management" className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243044] pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <span className="material-symbols-outlined text-[#1463FF]">tune</span>
          Strategy Controls
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="strategy-profile" className="text-xs font-medium text-slate-400">Strategy:</label>
          <select
            id="strategy-profile"
            value={activeStrategy}
            onChange={(e) => onStrategyChange(e.target.value)}
            className="bg-[#171920] border border-[#243044] rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 focus:outline-none focus:border-[#1463FF] max-w-[210px]"
          >
            <option value="KEYS v6 Liquidity Trap & SAR">KEYS v6 Liquidity Trap</option>
            <option value="KEYS v1 Trend & Momentum">KEYS v1 Trend & Momentum</option>
            <option value="Dynamic VWAP Bands">Dynamic VWAP Bands</option>
            <option value="Custom Pine Script">Custom Pine Script</option>
          </select>
          <button type="button" onClick={openSaveDialog} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#171920] border border-[#243044] text-slate-200 hover:text-[#1463FF] text-sm font-semibold">
            <span className="material-symbols-outlined !text-[16px]">save</span>Save
          </button>
          <button type="button" onClick={onLoadConfig} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#171920] border border-[#243044] text-slate-200 hover:text-[#1463FF] text-sm font-semibold">
            <span className="material-symbols-outlined !text-[16px]">folder_open</span>Load
          </button>
          <button type="button" onClick={onResetConfig} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#171920] border border-[#243044] text-slate-200 hover:text-[#1463FF] text-sm font-semibold">
            <span className="material-symbols-outlined !text-[16px]">restart_alt</span>Reset
          </button>
          <a href="/api/download-zip" download="keys-strategy-lab-complete.zip"
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-sm font-semibold">
            <span className="material-symbols-outlined !text-[16px]">download_for_offline</span>ZIP
          </a>
          <span role="status" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#171920] text-sm font-semibold">
            <span className={`h-2 w-2 rounded-full ${isBacktestRunning ? 'bg-amber-400 animate-pulse' : 'bg-[#0BBA74]'}`} />
            <span className={isBacktestRunning ? 'text-amber-400' : 'text-[#0BBA74]'}>{isBacktestRunning ? 'RUNNING' : 'READY'}</span>
          </span>
        </div>
      </section>
      {/* ─── QUICK PAGE SWITCHER ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="text-slate-500">PAGE 1 OF 4:</span>
          <span className="text-white font-bold flex items-center gap-1">
            <span className="material-symbols-outlined !text-[16px] text-blue-400">candlestick_chart</span>
            Chart & Historical Backtest Lab
          </span>
        </div>
        {onNavigateToPage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateToPage('results')}
              className="px-2.5 py-1 rounded-lg bg-[#171920] hover:bg-[#15233a] border border-[#172338] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer transition"
            >
              <span className="material-symbols-outlined !text-[14px]">bar_chart</span>
              <span>2. Backtest Results ↗</span>
            </button>
            <button
              onClick={() => onNavigateToPage('positions')}
              className="px-2.5 py-1 rounded-lg bg-[#171920] hover:bg-[#15233a] border border-[#172338] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer transition"
            >
              <span className="material-symbols-outlined !text-[14px]">layers</span>
              <span>3. Positions & Charts ↗</span>
            </button>
            <button
              onClick={() => onNavigateToPage('symbols')}
              className="px-2.5 py-1 rounded-lg bg-[#171920] hover:bg-[#15233a] border border-[#172338] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer transition"
            >
              <span className="material-symbols-outlined !text-[14px]">dataset</span>
              <span>4. Symbol Universe ↗</span>
            </button>
          </div>
        )}
      </div>

      {/* ─── 1. TOP CANDLESTICK CHART (Desktop height: 520px) ───────────────── */}
      <section className="space-y-2">
        <CandlestickChart
          symbol={displayedSymbol}
          onSymbolChange={setCurrentSymbol}
          availableSymbols={chartSymbolList}
          candles={candles}
          signals={signals}
          timeframeMinutes={chartTimeframe}
          onTimeframeChange={setChartTimeframe}
          height={520}
          showIndicators={false}
          isLive={isLiveActive}
          onToggleLive={() => setIsLiveActive((prev) => !prev)}
          lastUpdated={lastRefreshedAt}
          onRefresh={handleManualRefresh}
        />

      </section>

      {/* ─── 2. SUB-TABS NAVIGATION & SETTINGS PANELS ───────────────────── */}
      <section className="bg-[#171920] border border-[#172338] rounded-xl p-4 space-y-4">
        {/* Navigation Tabs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#152236]">
          <div className="flex items-center bg-[#171920] p-1.5 rounded-xl border border-[#1a2436] space-x-1.5">
            <button
              onClick={() => setActiveTab('strategy')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'strategy'
                  ? 'bg-[#1463FF] text-white shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">tune</span>
              <span>Strategy & Management</span>
            </button>

            <button
              onClick={() => setActiveTab('pnl')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'pnl'
                  ? 'bg-[#1463FF] text-white shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">layers</span>
              <span>PnL Rules ({pnlConfig.rules.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('indicator')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'indicator'
                  ? 'bg-[#1463FF] text-white shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">insights</span>
              <span>Indicator Settings</span>
            </button>

            <button
              onClick={() => setActiveTab('pinescript')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'pinescript'
                  ? 'bg-[#1463FF] text-white shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">code</span>
              <span>Pine Script Tab</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-300">Indicator Preset:</span>
            <select
              value={activeIndicator.id}
              onChange={(e) => {
                const found = indicators.find((ind) => ind.id === e.target.value);
                if (found) onSelectIndicator(found);
              }}
              className="bg-[#171920] border border-[#19273c] text-sm font-semibold text-slate-100 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {indicators.map((ind) => (
                <option key={ind.id} value={ind.id}>
                  {ind.name} ({ind.version})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ─── TAB 1: STRATEGY & MANAGEMENT ───────────────────────────────── */}
        {activeTab === 'strategy' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <span className="material-symbols-outlined text-amber-400 !text-xl">account_balance_wallet</span>
                <h2 className="text-lg font-bold text-amber-400 tracking-wide">
                  Portfolio & Cycle Management
                </h2>
              </div>
              <button
                onClick={openSaveDialog}
                className="px-4 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-semibold flex items-center space-x-1.5 shadow-sm transition"
              >
                <span className="material-symbols-outlined !text-[17px]">save</span>
                <span>Save Settings</span>
              </button>
            </div>

            {/* 3 Columns Configuration Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Column 1: Market & Symbol Universe */}
              <div className="bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3.5">
                <div className="flex items-center space-x-2 text-sm font-bold text-slate-200 pb-2 border-b border-[#142033]">
                  <span className="material-symbols-outlined text-amber-400 !text-lg">hub</span>
                  <span>Market & Symbol Universe</span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-slate-300 font-medium">Saved Symbol Group</span>
                    <button
                      onClick={onNavigateToSymbols}
                      className="text-blue-400 hover:underline flex items-center text-xs font-semibold"
                    >
                      Manage Universe ↗
                    </button>
                  </div>
                  <select
                    value={portfolioConfig.savedGroupId}
                    onChange={(e) =>
                      onUpdatePortfolioConfig({ ...portfolioConfig, savedGroupId: e.target.value })
                    }
                    className="w-full bg-[#171920] border border-[#19273c] text-sm text-slate-100 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 font-semibold"
                  >
                    {savedGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.symbols.length} Symbols)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Exchange Data Source</label>
                  <select
                    value={portfolioConfig.exchange}
                    onChange={(e) =>
                      onUpdatePortfolioConfig({
                        ...portfolioConfig,
                        exchange: e.target.value as any
                      })
                    }
                    className="w-full bg-[#171920] border border-[#19273c] text-sm text-slate-100 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 capitalize font-medium"
                  >
                    <option value="bybit">Bybit (USDT Perpetual)</option>
                    <option value="binance">Binance (USDT-M Futures)</option>
                    <option value="okx">OKX (USDT Swap)</option>
                    <option value="bitget">Bitget (USDT Futures)</option>
                    <option value="kucoin">KuCoin (USDT Futures)</option>
                    <option value="gateio">Gate.io (USDT Perpetual)</option>
                    <option value="mexc">MEXC (USDT Perpetual)</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-slate-300 font-medium">Max Open Positions</span>
                    <span className="text-blue-400 font-mono font-bold text-xs">{groupSymbolsCount} Selected in Group</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={portfolioConfig.maxOpenPositions}
                    onChange={(e) =>
                      onUpdatePortfolioConfig({
                        ...portfolioConfig,
                        maxOpenPositions: parseInt(e.target.value) || 100
                      })
                    }
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-white rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-900/30 text-xs text-blue-300 leading-relaxed">
                  ⓘ <strong>Saved Symbol Group</strong> defines the tested universe, while <strong>Max Open Positions</strong> limits concurrent open trades. Deterministic admission rule applies for simultaneous signals.
                </div>
              </div>

              {/* Column 2: Capital, Sizing & Margin Allocation */}
              <div className="bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3.5">
                <div className="flex items-center space-x-2 text-sm font-bold text-slate-200 pb-2 border-b border-[#142033]">
                  <span className="material-symbols-outlined text-amber-400 !text-lg">payments</span>
                  <span>Capital & Margin Allocation</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Initial Capital ($)</label>
                    <input
                      type="number"
                      min="10"
                      value={portfolioConfig.initialCapital}
                      onChange={(e) =>
                        onUpdatePortfolioConfig({
                          ...portfolioConfig,
                          initialCapital: parseFloat(e.target.value) || 300
                        })
                      }
                      className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-white rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Notional Size ($)</label>
                    <input
                      type="number"
                      min="1"
                      value={portfolioConfig.positionSizeNotional}
                      onChange={(e) =>
                        onUpdatePortfolioConfig({
                          ...portfolioConfig,
                          positionSizeNotional: parseFloat(e.target.value) || 10
                        })
                      }
                      className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-white rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Leverage Modes A & B */}
                <div className="p-3 rounded-lg bg-[#171920] border border-[#19273c] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={portfolioConfig.useMaxLeverage}
                        onChange={(e) =>
                          onUpdatePortfolioConfig({
                            ...portfolioConfig,
                            useMaxLeverage: e.target.checked
                          })
                        }
                        className="rounded border-slate-700 text-blue-600 focus:ring-0 w-4 h-4 bg-slate-900 cursor-pointer"
                      />
                      <span className="text-sm font-semibold text-slate-100">Mode A: Use Max Leverage</span>
                    </label>
                    <span className="text-xs text-emerald-400 font-mono font-bold">Auto Tier Max</span>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm text-slate-300">Mode B: Manual Leverage (x)</span>
                    <input
                      type="number"
                      min="1"
                      max="125"
                      disabled={portfolioConfig.useMaxLeverage}
                      value={portfolioConfig.manualLeverage}
                      onChange={(e) =>
                        onUpdatePortfolioConfig({
                          ...portfolioConfig,
                          manualLeverage: parseInt(e.target.value) || 10
                        })
                      }
                      className={`w-24 bg-[#171920] border border-[#1b2b44] rounded-lg px-2.5 py-1 text-base text-center font-bold font-mono ${
                        portfolioConfig.useMaxLeverage ? 'opacity-40 text-slate-500' : 'text-amber-400'
                      }`}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm pt-2 border-t border-[#142033]">
                    <span className="text-slate-400">Est. Initial Margin / Trade:</span>
                    <span className="text-[#0BBA74] font-mono font-bold text-base">
                      ${estimatedInitialMargin} USDT
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Margin Mode</label>
                  <select
                    value={portfolioConfig.marginMode}
                    onChange={(e) =>
                      onUpdatePortfolioConfig({
                        ...portfolioConfig,
                        marginMode: e.target.value as any
                      })
                    }
                    className="w-full bg-[#171920] border border-[#19273c] text-sm text-slate-100 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 font-semibold"
                  >
                    <option value="cross">Cross Margin (Shared Portfolio Equity)</option>
                    <option value="isolated">Isolated Margin (Independent Risk)</option>
                  </select>
                </div>
              </div>

              {/* Column 3: Timing, Limits & Execution */}
              <div className="bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3.5">
                <div className="flex items-center space-x-2 text-sm font-bold text-slate-200 pb-2 border-b border-[#142033]">
                  <span className="material-symbols-outlined text-amber-400 !text-lg">hourglass_top</span>
                  <span>Execution & Cycle Limits</span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Cycle Duration Range (Days)</label>
                  <div className="flex items-center space-x-2.5">
                    <span className="text-sm text-slate-400">From</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={portfolioConfig.cycleFromDay}
                      onChange={(e) =>
                        onUpdatePortfolioConfig({
                          ...portfolioConfig,
                          cycleFromDay: parseInt(e.target.value) || 1
                        })
                      }
                      className="w-20 bg-[#171920] border border-[#19273c] rounded-lg px-2 py-1.5 text-base text-slate-100 text-center font-mono font-bold"
                    />
                    <span className="text-sm text-slate-400">To</span>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={portfolioConfig.cycleToDay}
                      onChange={(e) =>
                        onUpdatePortfolioConfig({
                          ...portfolioConfig,
                          cycleToDay: parseInt(e.target.value) || 7
                        })
                      }
                      className="w-20 bg-[#171920] border border-[#19273c] rounded-lg px-2 py-1.5 text-base text-slate-100 text-center font-mono font-bold"
                    />
                    <span className="text-sm text-slate-300 font-medium">Days</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Backtest Timeframe (Minutes) — <span className="text-blue-400">Manual Input</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={portfolioConfig.backtestTimeframe}
                    onChange={(e) =>
                      onUpdatePortfolioConfig({
                        ...portfolioConfig,
                        backtestTimeframe: Math.max(1, parseInt(e.target.value) || 5)
                      })
                    }
                    className="w-full bg-[#171920] border border-[#19273c] text-base text-white font-mono font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Supports standard minutes: 5, 15, 30, 60, 240, 1440</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Historical Test Period</label>
                  <select value={portfolioConfig.testPeriodDays || 30}
                    onChange={(e) => onUpdatePortfolioConfig({ ...portfolioConfig, testPeriodDays: Number(e.target.value) })}
                    className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-3 py-2 text-base font-bold text-slate-100">
                    <option value={30}>30 Days</option>
                    <option value={90}>90 Days</option>
                    <option value={180}>180 Days</option>
                    <option value={365}>1 Year (365 Days)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Max DD Cutoff (%)</label>
                    <input
                      type="number"
                      value={portfolioConfig.maxDrawdownCutoff}
                      onChange={(e) =>
                        onUpdatePortfolioConfig({
                          ...portfolioConfig,
                          maxDrawdownCutoff: parseFloat(e.target.value) || 15
                        })
                      }
                      className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-base text-slate-100 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Slippage (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={portfolioConfig.slippageTolerance}
                      onChange={(e) =>
                        onUpdatePortfolioConfig({
                          ...portfolioConfig,
                          slippageTolerance: parseFloat(e.target.value) || 0.05
                        })
                      }
                      className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-base text-slate-100 font-mono font-bold"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: PNL RULES (5) ────────────────────────────────────────── */}
        {activeTab === 'pnl' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2.5">
                <span className="material-symbols-outlined text-amber-400 !text-xl">layers</span>
                <h2 className="text-lg font-bold text-amber-400 tracking-wide">
                  5-Stage PnL Rules (Basket Net Equity Trailing Drop Floor)
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center space-x-2 cursor-pointer bg-[#171920] px-3 py-1.5 rounded-lg border border-[#19273c]">
                  <input
                    type="checkbox"
                    checked={pnlConfig.fixedFloorEnabled}
                    onChange={(e) =>
                      onUpdatePnLConfig({
                        ...pnlConfig,
                        fixedFloorEnabled: e.target.checked
                      })
                    }
                    className="rounded border-slate-700 text-blue-600 focus:ring-0 w-4 h-4 bg-slate-900 cursor-pointer"
                  />
                  <span className="text-sm font-semibold text-slate-200">Fixed Floor Preset Mode</span>
                </label>
                <button
                  onClick={() => alert('PnL rules saved to persistent configuration.')}
                  className="px-4 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-semibold flex items-center space-x-1.5 shadow-sm transition"
                >
                  <span className="material-symbols-outlined !text-[17px]">save</span>
                  <span>Save PnL Rules</span>
                </button>
              </div>
            </div>

            {/* Explanation card */}
            <div className="p-3.5 rounded-xl bg-[#171920] border border-[#19273c] text-sm text-slate-300 flex items-start space-x-3 leading-relaxed">
              <span className="text-blue-400 font-bold text-lg mt-0.5">ⓘ</span>
              <div>
                <strong>Accounting Model:</strong> Basket PnL evaluates cumulative cycle net equity relative to initial balance.
                The maximum achieved net cycle profit is continually tracked. When net PnL pulls back from its peak by the configured drop percentage, the entire basket is liquidated.
                <span className="text-amber-300 font-mono block mt-1 font-bold text-base">
                  Exit Floor = Peak Profit × (1 − Profit Drop / 100)
                </span>
                <span className="text-slate-400 text-xs block mt-0.5">
                  Example: Peak at +100%, Drop 30% → Liquidate entire basket at +70% floor. Peak at +200%, Drop 30% → Exit at +140% floor.
                </span>
              </div>
            </div>

            {/* EXACT 5 EDITABLE ROWS TABLE */}
            <div className="overflow-x-auto bg-[#171920] border border-[#19273c] rounded-xl p-4">
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="border-b border-[#172338] text-xs text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="py-3 px-3">Stage #</th>
                    <th className="py-3 px-3">Profit From (%)</th>
                    <th className="py-3 px-3">Profit To (%)</th>
                    <th className="py-3 px-3">Profit Drop (%)</th>
                    <th className="py-3 px-3 font-sans">Calculated Exit Floor Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#131d2e]">
                  {pnlConfig.rules.map((row, idx) => {
                    const midPeak = (row.fromPct + row.toPct) / 2;
                    const exampleFloor = (midPeak * (1 - row.dropPct / 100)).toFixed(1);
                    return (
                      <tr key={idx} className="hover:bg-[#171920]/40 transition">
                        <td className="py-3 px-3 text-slate-400 font-bold text-sm">{idx + 1}</td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            value={row.fromPct}
                            onChange={(e) => {
                              const updated = [...pnlConfig.rules];
                              updated[idx].fromPct = parseFloat(e.target.value) || 0;
                              onUpdatePnLConfig({ ...pnlConfig, rules: updated });
                            }}
                            className="w-28 bg-[#171920] border border-[#1b2b44] rounded-lg px-3 py-1.5 text-slate-100 text-base font-bold text-center focus:border-blue-500"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            value={row.toPct}
                            onChange={(e) => {
                              const updated = [...pnlConfig.rules];
                              updated[idx].toPct = parseFloat(e.target.value) || 0;
                              onUpdatePnLConfig({ ...pnlConfig, rules: updated });
                            }}
                            className="w-28 bg-[#171920] border border-[#1b2b44] rounded-lg px-3 py-1.5 text-slate-100 text-base font-bold text-center focus:border-blue-500"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            value={row.dropPct}
                            onChange={(e) => {
                              const updated = [...pnlConfig.rules];
                              updated[idx].dropPct = parseFloat(e.target.value) || 0;
                              onUpdatePnLConfig({ ...pnlConfig, rules: updated });
                            }}
                            className="w-28 bg-[#171920] border border-[#1b2b44] rounded-lg px-3 py-1.5 text-amber-400 text-base font-bold text-center focus:border-blue-500"
                          />
                        </td>
                        <td className="py-3 px-3 text-sm text-slate-300 font-sans">
                          At peak +{midPeak}% → Liquidate basket at{' '}
                          <strong className="text-[#0BBA74] font-mono text-base font-bold">+{exampleFloor}%</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-4 pt-3 border-t border-[#172338] flex items-center justify-between">
                <span className="text-sm text-slate-300 font-medium">
                  Total Active Rule Stages: <strong className="text-white font-mono">5 Ranges</strong>
                </span>
                <button
                  onClick={() => {
                    const defaults: PnLRuleRow[] = [
                      { fromPct: 50, toPct: 80, dropPct: 30 },
                      { fromPct: 81, toPct: 120, dropPct: 30 },
                      { fromPct: 121, toPct: 150, dropPct: 30 },
                      { fromPct: 151, toPct: 200, dropPct: 30 },
                      { fromPct: 201, toPct: 500, dropPct: 30 }
                    ];
                    onUpdatePnLConfig({ ...pnlConfig, rules: defaults });
                  }}
                  className="px-3.5 py-1.5 text-sm text-slate-300 hover:text-white border border-[#1b2b44] rounded-lg hover:bg-[#121c2d] transition"
                >
                  Reset Default 5 Ranges
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 3: INDICATOR SETTINGS ──────────────────────────────────── */}
        {activeTab === 'indicator' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <span className="material-symbols-outlined text-blue-400 !text-xl">tune</span>
                <h2 className="text-lg font-bold text-blue-400 tracking-wide">
                  Indicator Settings ({activeIndicator.name})
                </h2>
              </div>
              <div className="flex items-center space-x-2.5">
                <button
                  onClick={handleApplyToChart}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center space-x-1.5 shadow-sm transition"
                >
                  <span className="material-symbols-outlined !text-[17px]">refresh</span>
                  <span>Apply to Chart</span>
                </button>
                <button
                  onClick={handleSaveIndicatorSettings}
                  className="px-4 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-semibold flex items-center space-x-1.5 shadow-sm transition"
                >
                  <span className="material-symbols-outlined !text-[17px]">save</span>
                  <span>Save Settings</span>
                </button>
              </div>
            </div>

            {/* Inputs grouped into 3 clean columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Group 1: General & Wick & Volume */}
              <div className="bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3">
                <div className="text-sm font-bold text-amber-400 pb-2 border-b border-[#142033] flex items-center gap-2">
                  <span className="material-symbols-outlined !text-lg">show_chart</span>
                  <span>Main Settings & Wick Analysis</span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Period (Channels & SAR Extreme)
                  </label>
                  <input
                    type="number"
                    value={localParams['length'] ?? 200}
                    onChange={(e) => setLocalParams({ ...localParams, length: parseInt(e.target.value) || 200 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Wick Threshold (Liquidity Anomaly)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={localParams['wick_threshold'] ?? 0.6}
                    onChange={(e) => setLocalParams({ ...localParams, wick_threshold: parseFloat(e.target.value) || 0.6 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Volume SMA Period</label>
                  <input
                    type="number"
                    value={localParams['volumeSMA_Period'] ?? 20}
                    onChange={(e) => setLocalParams({ ...localParams, volumeSMA_Period: parseInt(e.target.value) || 20 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Volume Multiplier (Spike)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={localParams['volume_multiplier'] ?? 1.5}
                    onChange={(e) => setLocalParams({ ...localParams, volume_multiplier: parseFloat(e.target.value) || 1.5 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>
              </div>

              {/* Group 2: RSI & Trend ADX */}
              <div className="bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3">
                <div className="text-sm font-bold text-blue-400 pb-2 border-b border-[#142033] flex items-center gap-2">
                  <span className="material-symbols-outlined !text-lg">speed</span>
                  <span>RSI & ADX Trend Settings</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">RSI Period</label>
                    <input
                      type="number"
                      value={localParams['rsiPeriod'] ?? 14}
                      onChange={(e) => setLocalParams({ ...localParams, rsiPeriod: parseInt(e.target.value) || 14 })}
                      className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">ADX Smoothing</label>
                    <input
                      type="number"
                      value={localParams['adxlen'] ?? 14}
                      onChange={(e) => setLocalParams({ ...localParams, adxlen: parseInt(e.target.value) || 14 })}
                      className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">RSI Oversold</label>
                    <input
                      type="number"
                      value={localParams['rsiOversold_Level'] ?? 30}
                      onChange={(e) => setLocalParams({ ...localParams, rsiOversold_Level: parseInt(e.target.value) || 30 })}
                      className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-[#0BBA74] rounded-lg px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">RSI Overbought</label>
                    <input
                      type="number"
                      value={localParams['rsiOverbought_Level'] ?? 70}
                      onChange={(e) => setLocalParams({ ...localParams, rsiOverbought_Level: parseInt(e.target.value) || 70 })}
                      className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-[#FF4761] rounded-lg px-3 py-1.5"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">DI Length</label>
                  <input
                    type="number"
                    value={localParams['dilen'] ?? 14}
                    onChange={(e) => setLocalParams({ ...localParams, dilen: parseInt(e.target.value) || 14 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Trend Strength Threshold (ADX)</label>
                  <input
                    type="number"
                    value={localParams['Adx_trendThreshold'] ?? 30}
                    onChange={(e) => setLocalParams({ ...localParams, Adx_trendThreshold: parseInt(e.target.value) || 30 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>
              </div>

              {/* Group 3: Parabolic SAR Filter */}
              <div className="bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3">
                <div className="text-sm font-bold text-emerald-400 pb-2 border-b border-[#142033] flex items-center gap-2">
                  <span className="material-symbols-outlined !text-lg">filter_alt</span>
                  <span>Parabolic SAR Filter</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-[#171920] border border-[#19273c]">
                  <span className="text-sm font-semibold text-slate-200">Enable SAR Direction Filter</span>
                  <input
                    type="checkbox"
                    checked={localParams['useSARFilter'] ?? true}
                    onChange={(e) => setLocalParams({ ...localParams, useSARFilter: e.target.checked })}
                    className="rounded border-slate-700 text-blue-600 focus:ring-0 w-4 h-4 bg-slate-900 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">SAR Start</label>
                  <input
                    type="number"
                    step="0.005"
                    value={localParams['sarStart'] ?? 0.02}
                    onChange={(e) => setLocalParams({ ...localParams, sarStart: parseFloat(e.target.value) || 0.02 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">SAR Increment</label>
                  <input
                    type="number"
                    step="0.005"
                    value={localParams['sarIncrement'] ?? 0.02}
                    onChange={(e) => setLocalParams({ ...localParams, sarIncrement: parseFloat(e.target.value) || 0.02 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">SAR Maximum</label>
                  <input
                    type="number"
                    step="0.05"
                    value={localParams['sarMaximum'] ?? 0.2}
                    onChange={(e) => setLocalParams({ ...localParams, sarMaximum: parseFloat(e.target.value) || 0.2 })}
                    className="w-full bg-[#171920] border border-[#19273c] text-base font-bold font-mono text-slate-100 rounded-lg px-3 py-1.5"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 4: PINE SCRIPT TAB ─────────────────────────────────────── */}
        {activeTab === 'pinescript' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2.5">
                <span className="material-symbols-outlined text-purple-400 !text-xl">code</span>
                <h2 className="text-lg font-bold text-purple-400 tracking-wide">
                  Pine Script Indicator Engine & Input Discovery
                </h2>
              </div>
              <div className="flex items-center space-x-2.5">
                <button
                  onClick={handleCompileScript}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center space-x-1.5 shadow-sm transition"
                >
                  <span className="material-symbols-outlined !text-[17px]">check_circle</span>
                  <span>Compile & Validate Script</span>
                </button>
              </div>
            </div>

            {/* Validation Message Bar */}
            <div
              className={`p-3 rounded-lg border text-sm flex items-center justify-between ${
                compileStatus.valid
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                  : 'bg-rose-950/20 border-rose-800/40 text-rose-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="font-bold">{compileStatus.valid ? '✓' : '⚠'}</span>
                <span>{compileStatus.message}</span>
              </div>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-black/40 border border-white/10">
                PINE SCRIPT v6 COMPLIANT
              </span>
            </div>

            {/* Code Editor */}
            <div className="relative rounded-xl border border-[#19273c] bg-[#171920] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-[#171920] border-b border-[#152236] text-xs text-slate-300 font-mono">
                <span>KEYS_Strategy_Indicator.pine</span>
                <span>Auto-discovers input(), input.int(), input.float(), input.bool()</span>
              </div>
              <textarea
                value={editorCode}
                onChange={(e) => setEditorCode(e.target.value)}
                rows={14}
                className="w-full bg-[#171920] p-4 text-sm font-mono text-emerald-300 leading-relaxed focus:outline-none resize-y selection:bg-blue-600 selection:text-white"
                spellCheck={false}
              />
            </div>
          </div>
        )}
      </section>

      {/* ─── 3. BOTTOM GREEN ACTION BAR ─────────────────────────────────── */}
      <section className="bg-[#171920] border border-[#172338] rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => onRunBacktest(localParams)}
              disabled={isBacktestRunning}
              className={`px-8 py-3 rounded-xl text-base font-extrabold flex items-center space-x-2.5 transition shadow-lg ${
                isBacktestRunning
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-[#0BBA74] hover:bg-emerald-500 text-slate-950 shadow-emerald-500/20 active:scale-95'
              }`}
            >
              <span className="material-symbols-outlined !font-bold !text-[22px]">play_arrow</span>
              <span>
                {isBacktestRunning
                  ? `Simulating... (${backtestProgress}%)`
                  : `Run Backtest (${portfolioConfig.backtestTimeframe}m)`}
              </span>
            </button>

            <button
              onClick={onStopBacktest}
              disabled={!isBacktestRunning}
              className={`px-5 py-3 rounded-xl border text-sm font-bold flex items-center space-x-2 transition ${
                isBacktestRunning
                  ? 'bg-rose-950/40 border-rose-700/60 text-rose-300 hover:bg-rose-900/50'
                  : 'bg-[#171920] border-[#1a2436] text-slate-600 cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">stop</span>
              <span>Stop</span>
            </button>
          </div>

          {/* Status and Progress Info */}
          <div className="flex flex-wrap items-center gap-5 text-sm font-mono">
            {isBacktestRunning && (
              <div className="flex items-center gap-4">
                <div className="w-36 bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700">
                  <div
                    className="bg-[#0BBA74] h-full transition-all duration-300"
                    style={{ width: `${backtestProgress}%` }}
                  />
                </div>
                <span className="text-slate-300">
                  Date: <strong className="text-white font-bold">{currentDateProgress || 'Simulating'}</strong>
                </span>
                <span className="text-slate-300">
                  Active Positions:{' '}
                  <strong className="text-amber-400 font-bold">{openPositionsCount}</strong>
                </span>
              </div>
            )}

            {/* Last Completed Backtest Notification */}
            {lastCompletedRun && !isBacktestRunning && (
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-600/50 shadow-sm animate-fadeIn">
                <span className="material-symbols-outlined text-[#0BBA74] !text-[18px]">verified</span>
                <span className="text-slate-200 text-xs sm:text-sm font-mono">
                  <strong className="text-white font-extrabold">{lastCompletedRun.id}</strong> ({lastCompletedRun.netPnl >= 0 ? '+' : ''}${lastCompletedRun.netPnl.toFixed(2)}, {lastCompletedRun.winRate.toFixed(1)}% WR)
                </span>
                {onNavigateToResults && (
                  <button
                    onClick={onNavigateToResults}
                    className="px-3 py-1 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-xs font-bold flex items-center space-x-1 shadow transition active:scale-95"
                  >
                    <span>View Results</span>
                    <span className="material-symbols-outlined !text-[14px]">arrow_forward</span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 text-slate-300">
              <span className="material-symbols-outlined !text-[18px]">schedule</span>
              <span>Status:</span>
              <strong className={`font-bold text-base ${isBacktestRunning ? 'text-amber-400' : 'text-[#0BBA74]'}`}>
                {isBacktestRunning ? `Running Backtest (${backtestProgress}%)` : 'Idle • Ready for Simulation'}
              </strong>
            </div>
          </div>
        </div>
      </section>
      {showSaveDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4" role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !savingConfig) setShowSaveDialog(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="save-lab-settings-title"
            className="w-full max-w-md rounded-xl border border-[#243044] bg-[#171920] p-5 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <span className="material-symbols-outlined text-[#1463FF] !text-[25px]">save</span>
              <h3 id="save-lab-settings-title" className="text-lg font-bold text-white">Save Lab Settings</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              Save the current symbol group, exchange, capital, backtest period, margin, PnL rules and selected indicator on the server?
            </p>
            <div className="mt-3 rounded-lg bg-[#101216] p-3 text-sm text-slate-300">
              <span className="font-bold text-white">{activeIndicator.name}</span>
              <span className="mx-2 text-slate-600">•</span>
              {portfolioConfig.testPeriodDays || 30} days
              <span className="mx-2 text-slate-600">•</span>
              {portfolioConfig.backtestTimeframe}m
            </div>
            {saveMessage && (
              <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-sm ${saveSucceeded ? 'border-[#0BBA74]/40 bg-[#0BBA74]/10 text-[#0BBA74]' : 'border-[#FF4761]/40 bg-[#FF4761]/10 text-[#FF4761]'}`}>
                {saveMessage}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={savingConfig} onClick={() => setShowSaveDialog(false)}
                className="rounded-lg border border-[#243044] px-4 py-2 text-sm font-semibold text-slate-300 disabled:opacity-50">
                {saveSucceeded ? 'Close' : 'Cancel'}
              </button>
              {!saveSucceeded && (
                <button type="button" disabled={savingConfig} onClick={confirmSaveConfig}
                  className="rounded-lg bg-[#1463FF] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {savingConfig ? 'Saving...' : 'Save Settings'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
