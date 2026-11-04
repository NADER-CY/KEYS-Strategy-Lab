import React, { useState, useEffect } from 'react';
import { Header, AppPage } from './components/Header';
import { ChartBacktestPage } from './pages/ChartBacktestPage';
import { BacktestResultsPage } from './pages/BacktestResultsPage';
import { PositionsChartsPage } from './pages/PositionsChartsPage';
import { SymbolSelectionPage } from './pages/SymbolSelectionPage';
import {
  PortfolioConfig,
  PnLConfig,
  SavedSymbolGroup,
  SavedIndicator,
  BacktestRun,
  ExchangeId
} from './types';
import { SAVED_INDICATORS_DEFAULT } from './engine/defaultPineScripts';

export default function App() {
  const pageRoutes: Record<AppPage, string> = {
    chart: '/chart-backtest',
    results: '/backtest-results',
    positions: '/positions-charts',
    symbols: '/symbol-universe'
  };
  const pageFromPath = (): AppPage =>
    (Object.entries(pageRoutes).find(([, path]) => path === window.location.pathname)?.[0] as AppPage) || 'chart';
  const [currentPage, setCurrentPage] = useState<AppPage>(pageFromPath);
  const navigatePage = (page: AppPage) => {
    if (window.location.pathname !== pageRoutes[page]) {
      window.history.pushState({ page }, '', pageRoutes[page]);
    }
    setCurrentPage(page);
  };
  useEffect(() => {
    const handleHistory = () => setCurrentPage(pageFromPath());
    window.addEventListener('popstate', handleHistory);
    return () => window.removeEventListener('popstate', handleHistory);
  }, []);


  // Portfolio Configuration
  const [portfolioConfig, setPortfolioConfig] = useState<PortfolioConfig>({
    exchange: 'bybit',
    savedGroupId: 'tab_100_bybit',
    initialCapital: 300,
    positionSizeNotional: 10,
    useMaxLeverage: true,
    manualLeverage: 10,
    marginMode: 'cross',
    maxOpenPositions: 100,
    cycleFromDay: 1,
    cycleToDay: 7,
    backtestTimeframe: 5,
    testPeriodDays: 365,
    maxDrawdownCutoff: 15,
    slippageTolerance: 0.05,
    feeTakerPct: 0.055,
    feeMakerPct: 0.02,
    fundingRate8hPct: 0.01
  });

  // 5-Stage PnL Rules Configuration
  const [pnlConfig, setPnLConfig] = useState<PnLConfig>({
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
  });

  // Saved Groups & Indicators
  const [savedGroups, setSavedGroups] = useState<SavedSymbolGroup[]>([]);
  const [indicators, setIndicators] = useState<SavedIndicator[]>(SAVED_INDICATORS_DEFAULT);
  const [activeIndicator, setActiveIndicator] = useState<SavedIndicator>(SAVED_INDICATORS_DEFAULT[0]);
  const [activeStrategyName, setActiveStrategyName] = useState<string>('KEYS v6 Liquidity Trap & SAR');

  // Backtest Runs & Execution
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const [inspectTradeId, setInspectTradeId] = useState<string | null>(null);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isBacktestRunning, setIsBacktestRunning] = useState<boolean>(false);
  const [backtestProgress, setBacktestProgress] = useState<number>(0);
  const [currentDateProgress, setCurrentDateProgress] = useState<string | undefined>(undefined);
  const [openPositionsCount, setOpenPositionsCount] = useState<number>(0);
  const [lastCompletedRun, setLastCompletedRun] = useState<BacktestRun | null>(null);
  const [chartActiveSymbol, setChartActiveSymbol] = useState<string | undefined>(undefined);

  // Load initial data from server APIs
  useEffect(() => {
    // Load related profiles together so saved settings cannot be overwritten
    // by a later async default-group or default-indicator response.
    Promise.all([
      fetch('/api/groups').then((r) => r.json()),
      fetch('/api/indicators').then((r) => r.json()),
      fetch('/api/lab-settings').then((r) => r.json())
    ]).then(([groups, savedIndicators, settings]) => {
      if (Array.isArray(groups) && groups.length > 0) setSavedGroups(groups);
      if (Array.isArray(savedIndicators) && savedIndicators.length > 0) setIndicators(savedIndicators);
      if (settings?.portfolioConfig && settings?.pnlConfig) {
        setPortfolioConfig(settings.portfolioConfig);
        setPnLConfig(settings.pnlConfig);
      } else if (Array.isArray(groups) && groups.length > 0) {
        setPortfolioConfig((prev) => ({ ...prev, savedGroupId: groups[0].id, exchange: groups[0].exchange }));
      }
      const chosen = savedIndicators?.find?.((i: SavedIndicator) => i.id === settings?.indicatorId)
        || savedIndicators?.[0];
      if (chosen) {
        setActiveIndicator(chosen);
        setActiveStrategyName(chosen.name);
      }
    }).catch((err) => console.error('Failed to load saved lab profiles:', err));

    // 3. Runs
    fetch('/api/backtest/runs')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setRuns(data);
          const runWithTrades = data.find((r: BacktestRun) => r.trades && r.trades.length > 0);
          setSelectedRunId(runWithTrades ? runWithTrades.id : data[0].id);
        }
      })
      .catch((err) => console.error('Failed to load runs:', err));
  }, []);

  // Poll running job
  useEffect(() => {
    if (!activeJobId || !isBacktestRunning) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/backtest/status/${activeJobId}`);
        if (res.ok) {
          const data = await res.json();
          setBacktestProgress(data.progress || 0);
          setCurrentDateProgress(data.currentDate);
          setOpenPositionsCount(data.openPositionsCount || 0);

          if (data.status === 'COMPLETED' || data.status === 'STOPPED' || data.status === 'FAILED') {
            setIsBacktestRunning(false);
            setActiveJobId(null);

            // refresh runs list
            const runsRes = await fetch('/api/backtest/runs');
            if (runsRes.ok) {
              const updatedRuns: BacktestRun[] = await runsRes.json();
              setRuns(updatedRuns);
              const targetId = data.run?.id || activeJobId;
              const finished = updatedRuns.find((r) => r.id === targetId);
              if (finished) {
                setLastCompletedRun(finished);
                setSelectedRunId(finished.id);
              }
            }
          }
        }
      } catch (err) {
        console.error('Job polling error:', err);
      }
    }, 600);

    return () => clearInterval(interval);
  }, [activeJobId, isBacktestRunning]);

  // Start new backtest
  const handleRunBacktest = async (
    overrideConfig?: PortfolioConfig,
    overrideIndicatorParams?: Record<string, any>
  ) => {
    const configToUse = overrideConfig || portfolioConfig;
    const paramsToUse =
      overrideIndicatorParams ||
      activeIndicator.params.reduce((acc, p) => ({ ...acc, [p.name]: p.value }), {});

    try {
      setIsBacktestRunning(true);
      setBacktestProgress(0);
      setLastCompletedRun(null);

      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioConfig: configToUse,
          pnlConfig,
          indicatorParams: paramsToUse,
          strategyName: activeIndicator.name,
          indicatorId: activeIndicator.id
        })
      });

      if (res.ok) {
        const data = await res.json();
        setActiveJobId(data.runId);
      } else {
        setIsBacktestRunning(false);
        const errData = await res.json();
        alert(`Backtest failed to initiate: ${errData.error}`);
      }
    } catch (err: any) {
      setIsBacktestRunning(false);
      alert(`Error starting backtest: ${err.message}`);
    }
  };

  const handleStopBacktest = async () => {
    if (activeJobId) {
      await fetch(`/api/backtest/stop/${activeJobId}`, { method: 'POST' });
    }
    setIsBacktestRunning(false);
  };

  // Group Management
  const handleSaveGroup = async (group: SavedSymbolGroup) => {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(group)
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `Unable to save symbol group (HTTP ${res.status})`);
    }
    const saved = await res.json();
    setSavedGroups((prev) => {
      const idx = prev.findIndex((g) => g.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  };

  const handleDeleteGroup = async (id: string) => {
    await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    setSavedGroups((prev) => prev.filter((g) => g.id !== id));
  };

  // Indicator Management
  const handleSaveIndicator = async (ind: SavedIndicator) => {
    const res = await fetch('/api/indicators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ind)
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `HTTP ${res.status}`);
    }
    if (res.ok) {
      const saved = await res.json();
      setIndicators((prev) => {
        const idx = prev.findIndex((i) => i.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setActiveIndicator(saved);
    }
  };

  const handleDeleteRuns = async (ids: string[]): Promise<void> => {
    const targets = [...new Set(ids)];
    const running = runs.filter((r) => targets.includes(r.id) && r.status === 'RUNNING');
    if (running.length) throw new Error('Stop running backtests before deleting them.');
    const deleted: string[] = [];
    try {
      // Sequential requests avoid read-modify-write races in the JSON file store.
      for (const id of targets) {
        const response = await fetch(`/api/backtest/runs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`Failed to delete ${id}: HTTP ${response.status}`);
        deleted.push(id);
      }
    } finally {
      if (deleted.length) {
        const removed = new Set(deleted);
        setRuns((prev) => prev.filter((r) => !removed.has(r.id)));
        setSelectedRunId((prev) => prev && removed.has(prev)
          ? runs.find((r) => !removed.has(r.id))?.id
          : prev);
        setLastCompletedRun((prev) => prev && removed.has(prev.id) ? null : prev);
        setInspectTradeId(null);
      }
    }
  };

  const handleDeleteRun = async (id: string): Promise<void> => handleDeleteRuns([id]);

  const handleInspectTradeOnChart = (runId: string, tradeId: string) => {
    setSelectedRunId(runId);
    setInspectTradeId(tradeId);
    navigatePage('positions');
  };

  const handleCloneRunSettings = (run: BacktestRun) => {
    if (run.portfolioConfig) {
      setPortfolioConfig(run.portfolioConfig);
    }
    if (run.pnlConfig) {
      setPnLConfig(run.pnlConfig);
    }
    if (run.strategyName) {
      setActiveStrategyName(run.strategyName);
      const found = indicators.find((ind) => ind.name.toLowerCase().includes(run.strategyName.toLowerCase()));
      if (found) setActiveIndicator(found);
    }
    navigatePage('chart');
  };

  const handleApplyUniverseToBacktest = (groupId: string, autoRun = false) => {
    const group = savedGroups.find((g) => g.id === groupId);
    if (group) {
      const updatedCfg: PortfolioConfig = {
        ...portfolioConfig,
        savedGroupId: group.id,
        exchange: group.exchange
      };
      setPortfolioConfig(updatedCfg);
      navigatePage('chart');
      if (autoRun) {
        setTimeout(() => {
          handleRunBacktest(updatedCfg);
        }, 150);
      }
    }
  };

  const handleSaveLabSettings = async () => {
    const response = await fetch('/api/lab-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolioConfig, pnlConfig, indicatorId: activeIndicator.id })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    const result = await response.json();
    if (result.saved !== true) throw new Error('Server did not confirm saving settings');
  };

  const handleLoadLabSettings = async () => {
    try {
      const response = await fetch('/api/lab-settings');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const settings = await response.json();
      if (!settings?.portfolioConfig || !settings?.pnlConfig) throw new Error('No saved settings found');
      setPortfolioConfig(settings.portfolioConfig);
      setPnLConfig(settings.pnlConfig);
      const indicator = indicators.find((i) => i.id === settings.indicatorId);
      if (indicator) { setActiveIndicator(indicator); setActiveStrategyName(indicator.name); }
      alert('Saved settings restored.');
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#101216] text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white">
      {/* ─── TOP HORIZONTAL NAVIGATION ───────────────────────────────────── */}
      <Header
        currentPage={currentPage}
        onPageChange={navigatePage}

      />

      {/* ─── MAIN CONTENT VIEW (EXACTLY 4 PAGES, NO LEFT SIDEBAR) ────────── */}
      <main className="flex-1 max-w-[1850px] w-full mx-auto p-3 sm:p-4">
        {currentPage === 'chart' && (
          <ChartBacktestPage
            activeStrategy={activeStrategyName}
            onStrategyChange={(s) => {
              setActiveStrategyName(s);
              const found = indicators.find((ind) => ind.name.toLowerCase().includes(s.toLowerCase()));
              if (found) setActiveIndicator(found);
            }}
            onSaveConfig={handleSaveLabSettings}
            onLoadConfig={handleLoadLabSettings}
            onResetConfig={() => {
              if (confirm('Reset strategy lab settings to defaults?')) window.location.reload();
            }}
            portfolioConfig={portfolioConfig}
            onUpdatePortfolioConfig={setPortfolioConfig}
            pnlConfig={pnlConfig}
            onUpdatePnLConfig={setPnLConfig}
            savedGroups={savedGroups}
            indicators={indicators}
            activeIndicator={activeIndicator}
            onSelectIndicator={(indicator) => {
              setActiveIndicator(indicator);
              setActiveStrategyName(indicator.name);
            }}
            onSaveIndicator={handleSaveIndicator}
            onRunBacktest={(params) => handleRunBacktest(undefined, params)}
            onStopBacktest={handleStopBacktest}
            isBacktestRunning={isBacktestRunning}
            backtestProgress={backtestProgress}
            currentDateProgress={currentDateProgress}
            openPositionsCount={openPositionsCount}
            onNavigateToSymbols={() => navigatePage('symbols')}
            initialSymbol={chartActiveSymbol}
            lastCompletedRun={lastCompletedRun}
            onNavigateToResults={() => navigatePage('results')}
            onNavigateToPage={navigatePage}
          />
        )}

        {currentPage === 'results' && (
          <BacktestResultsPage
            runs={runs}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onDeleteRun={handleDeleteRun}
            onDeleteRuns={handleDeleteRuns}
            onInspectTradeOnChart={handleInspectTradeOnChart}
            onNewBacktest={() => navigatePage('chart')}
            onCloneSettingsToBacktest={handleCloneRunSettings}
            onNavigateToPage={navigatePage}
          />
        )}

        {currentPage === 'positions' && (
          <PositionsChartsPage
            runs={runs}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onDeleteRun={handleDeleteRun}
            inspectTradeId={inspectTradeId}
            onNewBacktest={() => navigatePage('chart')}
            onNavigateToPage={navigatePage}
            onTestSymbolOnChart={(sym) => {
              setChartActiveSymbol(sym);
              navigatePage('chart');
            }}
          />
        )}

        {currentPage === 'symbols' && (
          <SymbolSelectionPage
            currentExchange={portfolioConfig.exchange}
            onExchangeChange={(ex) => setPortfolioConfig((prev) => ({ ...prev, exchange: ex }))}
            savedGroups={savedGroups}
            onSaveGroup={handleSaveGroup}
            onDeleteGroup={handleDeleteGroup}
            onApplyUniverseToBacktest={handleApplyUniverseToBacktest}
            onNavigateToPage={navigatePage}
          />
        )}
      </main>
    </div>
  );
}
