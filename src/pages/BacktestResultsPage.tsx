import React, { useState } from 'react';
import { BacktestRun } from '../types';

interface BacktestResultsPageProps {
  runs: BacktestRun[];
  selectedRunId?: string;
  onSelectRun: (id: string) => void;
  onDeleteRun: (id: string) => void;
  onInspectTradeOnChart: (runId: string, tradeId: string) => void;
  onNewBacktest: () => void;
  onCloneSettingsToBacktest?: (run: BacktestRun) => void;
  onNavigateToPage?: (page: 'chart' | 'results' | 'positions' | 'symbols') => void;
}

export const BacktestResultsPage: React.FC<BacktestResultsPageProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  onDeleteRun,
  onInspectTradeOnChart,
  onNewBacktest,
  onCloneSettingsToBacktest,
  onNavigateToPage
}) => {
  const [exchangeFilter, setExchangeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'real' | 'demo'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState<boolean>(false);
  const [detailTab, setDetailTab] = useState<'summary' | 'settings' | 'pnl' | 'params' | 'trades' | 'equity'>('summary');
  const [tradeSearch, setTradeSearch] = useState<string>('');
  const [tradeFilterReason, setTradeFilterReason] = useState<string>('all');

  // Filtered runs
  const filteredRuns = runs.filter((r) => {
    if (exchangeFilter !== 'all' && r.exchange !== exchangeFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (modeFilter === 'real' && r.isDemo) return false;
    if (modeFilter === 'demo' && !r.isDemo) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.strategyName.toLowerCase().includes(q) ||
        r.symbolGroupName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeRun = runs.find((r) => r.id === selectedRunId) || filteredRuns[0] || runs[0];

  const handleToggleCompare = (id: string) => {
    if (selectedForCompare.includes(id)) {
      setSelectedForCompare(selectedForCompare.filter((item) => item !== id));
    } else {
      if (selectedForCompare.length < 4) {
        setSelectedForCompare([...selectedForCompare, id]);
      } else {
        alert('You can compare up to 4 backtest runs simultaneously.');
      }
    }
  };

  const handleExport = (runId: string, format: 'json' | 'csv') => {
    window.open(`/api/backtest/export/${runId}?format=${format}`, '_blank');
  };

  return (
    <div className="space-y-4 pb-12 animate-fadeIn">
      {/* ─── QUICK PAGE SWITCHER ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="text-slate-500">PAGE 2 OF 4:</span>
          <span className="text-white font-bold flex items-center gap-1">
            <span className="material-symbols-outlined !text-[16px] text-blue-400">bar_chart</span>
            Backtest List & Performance
          </span>
        </div>
        {onNavigateToPage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateToPage('chart')}
              className="px-2.5 py-1 rounded-lg bg-[#171920] hover:bg-[#15233a] border border-[#172338] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer transition"
            >
              <span className="material-symbols-outlined !text-[14px]">candlestick_chart</span>
              <span>1. Chart Lab ↗</span>
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
              <span>4. Universe ↗</span>
            </button>
          </div>
        )}
      </div>

      {/* ─── TOP SECTION: BACKTEST RUNS LIST ──────────────────────────────── */}
      <section className="bg-[#171920] border border-[#172338] rounded-xl p-4 space-y-4">
        {/* Title and Top Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="material-symbols-outlined text-blue-400 !text-2xl">bar_chart</span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">Backtest List & Performance</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                All historical backtest simulations, performance metrics, and cycle results
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {selectedForCompare.length >= 2 && (
              <button
                onClick={() => setShowCompareModal(true)}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold flex items-center space-x-1.5 shadow-sm transition"
              >
                <span className="material-symbols-outlined !text-[17px]">compare_arrows</span>
                <span>Compare ({selectedForCompare.length}) Runs</span>
              </button>
            )}

            <button
              onClick={onNewBacktest}
              className="px-4 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-bold flex items-center space-x-1.5 shadow-sm transition"
            >
              <span className="material-symbols-outlined !text-[17px]">add</span>
              <span>+ New Backtest</span>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-2 border-t border-[#142033]">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Exchange</label>
            <select
              value={exchangeFilter}
              onChange={(e) => setExchangeFilter(e.target.value)}
              className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-100 capitalize"
            >
              <option value="all">All Exchanges</option>
              <option value="bybit">Bybit</option>
              <option value="binance">Binance</option>
              <option value="okx">OKX</option>
              <option value="bitget">Bitget</option>
              <option value="kucoin">KuCoin</option>
              <option value="gateio">Gate.io</option>
              <option value="mexc">MEXC</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-100"
            >
              <option value="all">All Status</option>
              <option value="COMPLETED">Completed</option>
              <option value="RUNNING">Running</option>
              <option value="STOPPED">Stopped</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Data Mode</label>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as any)}
              className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-100"
            >
              <option value="all">All Runs</option>
              <option value="real">Real Backtests Only</option>
              <option value="demo">Demo Runs Only</option>
            </select>
          </div>

          <div className="col-span-2 sm:col-span-1 lg:col-span-3">
            <label className="block text-xs font-semibold text-slate-300 mb-1">Search Runs</label>
            <input
              type="text"
              placeholder="Search run ID, strategy, group..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Runs Master Table — 15-16px financial values */}
        <div className="overflow-x-auto bg-[#171920] border border-[#172338] rounded-xl">
          <table className="w-full text-left font-mono whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#172338] text-xs text-slate-400 font-semibold uppercase tracking-wider bg-[#171920]">
                <th className="py-3 px-3 text-center">#</th>
                <th className="py-3 px-3.5">Run ID</th>
                <th className="py-3 px-3">Date & Time</th>
                <th className="py-3 px-3">Exchange</th>
                <th className="py-3 px-3">Symbol Group</th>
                <th className="py-3 px-2 text-center">Symbols</th>
                <th className="py-3 px-3">Strategy</th>
                <th className="py-3 px-2 text-center">TF</th>
                <th className="py-3 px-2 text-center">Trades</th>
                <th className="py-3 px-3.5 text-right">Net PnL ($)</th>
                <th className="py-3 px-3.5 text-right">ROI %</th>
                <th className="py-3 px-3.5 text-right">Final Balance</th>
                <th className="py-3 px-3 text-center">Win Rate</th>
                <th className="py-3 px-3 text-center">Max DD</th>
                <th className="py-3 px-2 text-center">Cycles</th>
                <th className="py-3 px-2 text-center">Status</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#131d2e] text-sm tabular-nums">
              {filteredRuns.map((r, idx) => {
                const isSelected = activeRun?.id === r.id;
                const isChecked = selectedForCompare.includes(r.id);
                const netPnl = Number(r.netPnl || 0);
                const roiPct = Number(r.roiPct || 0);
                const finalBalance = Number(r.finalBalance || 300);
                const winRate = Number(r.winRate || 0);
                const maxDd = Number(r.maxDrawdownPct || 0);
                const isWin = netPnl >= 0;

                return (
                  <tr
                    key={r.id}
                    onClick={() => onSelectRun(r.id)}
                    className={`cursor-pointer transition ${
                      isSelected
                        ? 'bg-blue-950/30 border-l-4 border-l-[#1463FF]'
                        : 'hover:bg-[#171920]/50'
                    }`}
                  >
                    <td className="py-3 px-3 text-center text-slate-500">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleToggleCompare(r.id);
                        }}
                        title="Select for compare"
                        className="rounded border-slate-700 text-blue-600 focus:ring-0 w-4 h-4 cursor-pointer bg-slate-900"
                      />
                    </td>
                    <td className="py-3 px-3.5 font-bold text-white flex items-center gap-2">
                      <span className="text-blue-400 font-extrabold">{r.id}</span>
                      {r.isDemo ? (
                        <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-600/40 text-xs text-amber-300 font-sans font-bold uppercase">DEMO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-600/40 text-xs text-emerald-300 font-sans font-bold uppercase">REAL</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-xs">
                      {r.createdAt ? new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 16) : '—'}
                    </td>
                    <td className="py-3 px-3 uppercase font-semibold text-slate-300">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-xs text-amber-300 font-bold">
                        {r.exchange || 'BYBIT'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-200 font-sans font-medium">{r.symbolGroupName || 'Symbols'}</td>
                    <td className="py-3 px-2 text-center text-slate-300 font-semibold">{r.symbolsCount || 0}</td>
                    <td className="py-3 px-3 text-slate-200 font-sans font-medium">{r.strategyName || 'Strategy'}</td>
                    <td className="py-3 px-2 text-center text-blue-400 font-extrabold">{r.timeframeMinutes || 5}m</td>
                    <td className="py-3 px-2 text-center text-white font-bold">{r.totalTrades || 0}</td>
                    <td className={`py-3 px-3.5 text-right font-extrabold text-base ${isWin ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                      {isWin ? '+' : ''}${netPnl.toFixed(2)}
                    </td>
                    <td className={`py-3 px-3.5 text-right font-extrabold text-base ${isWin ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                      {isWin ? '+' : ''}{roiPct.toFixed(2)}%
                    </td>
                    <td className="py-3 px-3.5 text-right text-white font-extrabold text-base">
                      ${finalBalance.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-center text-[#0BBA74] font-bold">{winRate.toFixed(1)}%</td>
                    <td className="py-3 px-3 text-center text-rose-400 font-bold">-{Math.abs(maxDd).toFixed(1)}%</td>
                    <td className="py-3 px-2 text-center text-amber-300 font-extrabold">{r.completedCycles || 1}</td>
                    <td className="py-3 px-2 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                          r.status === 'COMPLETED'
                            ? 'bg-emerald-950/40 text-[#0BBA74] border border-emerald-800/40'
                            : r.status === 'RUNNING'
                            ? 'bg-amber-950/40 text-amber-400 border border-amber-800/40'
                            : 'bg-rose-950/40 text-[#FF4761] border border-rose-800/40'
                        }`}
                      >
                        {r.status || 'COMPLETED'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end space-x-1.5" onClick={(e) => e.stopPropagation()}>
                        {onCloneSettingsToBacktest && (
                          <button
                            onClick={() => onCloneSettingsToBacktest(r)}
                            title="Load settings & re-test"
                            className="p-1.5 rounded-lg bg-[#171920] hover:bg-blue-600/30 text-blue-400 hover:text-white transition"
                          >
                            <span className="material-symbols-outlined !text-[17px]">restart_alt</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleExport(r.id, 'json')}
                          title="Export JSON report"
                          className="p-1.5 rounded-lg bg-[#171920] hover:bg-[#15233a] text-slate-300 hover:text-white transition"
                        >
                          <span className="material-symbols-outlined !text-[17px]">download</span>
                        </button>
                        <button
                          onClick={() => handleExport(r.id, 'csv')}
                          title="Export CSV trades log"
                          className="p-1.5 rounded-lg bg-[#171920] hover:bg-[#15233a] text-slate-300 hover:text-white transition"
                        >
                          <span className="material-symbols-outlined !text-[17px]">table_view</span>
                        </button>
                        <button
                          onClick={() => onDeleteRun(r.id)}
                          title="Delete run"
                          className="p-1.5 rounded-lg bg-[#171920] hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 transition"
                        >
                          <span className="material-symbols-outlined !text-[17px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── BOTTOM SECTION: SELECTED BACKTEST DETAILS ──────────────────── */}
      {activeRun && (
        <section className="bg-[#171920] border border-[#172338] rounded-xl p-4 space-y-4">
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#142033]">
            <div className="flex items-center space-x-3">
              <span className="material-symbols-outlined text-amber-400 !text-2xl">insights</span>
              <h3 className="text-lg font-bold text-white flex items-center gap-2.5">
                <span>Backtest Details —</span>
                <span className="text-blue-400 font-mono font-extrabold">{activeRun.id}</span>
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-950/40 text-[#0BBA74] border border-emerald-800/40 text-xs font-bold font-mono">
                  {activeRun.status}
                </span>
                {onCloneSettingsToBacktest && (
                  <button
                    onClick={() => onCloneSettingsToBacktest(activeRun)}
                    className="ml-2 px-3 py-1 rounded-lg bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40 text-xs font-bold flex items-center gap-1 transition"
                  >
                    <span className="material-symbols-outlined !text-[15px]">restart_alt</span>
                    <span>Clone & Re-test ↗</span>
                  </button>
                )}
              </h3>
            </div>

            {/* Sub-tabs inside Details */}
            <div className="flex items-center bg-[#171920] p-1.5 rounded-xl border border-[#1a2436] space-x-1.5">
              <button
                onClick={() => setDetailTab('summary')}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                  detailTab === 'summary' ? 'bg-[#1463FF] text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Summary
              </button>
              <button
                onClick={() => setDetailTab('equity')}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                  detailTab === 'equity' ? 'bg-[#1463FF] text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Equity Curve
              </button>
              <button
                onClick={() => setDetailTab('trades')}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                  detailTab === 'trades' ? 'bg-[#1463FF] text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Trades ({(activeRun.trades || []).length})
              </button>
              <button
                onClick={() => setDetailTab('settings')}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                  detailTab === 'settings' ? 'bg-[#1463FF] text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Settings
              </button>
              <button
                onClick={() => setDetailTab('pnl')}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                  detailTab === 'pnl' ? 'bg-[#1463FF] text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                PnL Rules
              </button>
              <button
                onClick={() => setDetailTab('params')}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                  detailTab === 'params' ? 'bg-[#1463FF] text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                Indicator Params
              </button>
            </div>
          </div>

          {/* 8 Primary Financial Value Metric Cards: 20–24px */}
          {(() => {
            const initialCapital = Number(activeRun.initialCapital || 300);
            const finalBalance = Number(activeRun.finalBalance || 300);
            const netPnl = Number(activeRun.netPnl || 0);
            const roiPct = Number(activeRun.roiPct || 0);
            const winRate = Number(activeRun.winRate || 0);
            const maxDd = Number(activeRun.maxDrawdownPct || 0);
            const completedCycles = Number(activeRun.completedCycles || 1);
            const profitFactor = Number(activeRun.profitFactor || 0);
            const sharpeRatio = Number(activeRun.sharpeRatio || 0);

            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Initial Capital</span>
                  <span className="text-xl sm:text-2xl font-extrabold text-white font-mono mt-1 block tabular-nums">
                    ${initialCapital.toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Final Balance</span>
                  <span className="text-xl sm:text-2xl font-extrabold text-white font-mono mt-1 block tabular-nums">
                    ${finalBalance.toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Net Profit ($)</span>
                  <span
                    className={`text-xl sm:text-2xl font-extrabold font-mono mt-1 block tabular-nums ${
                      netPnl >= 0 ? 'text-[#0BBA74]' : 'text-[#FF4761]'
                    }`}
                  >
                    {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">ROI (%)</span>
                  <span
                    className={`text-xl sm:text-2xl font-extrabold font-mono mt-1 block tabular-nums ${
                      roiPct >= 0 ? 'text-[#0BBA74]' : 'text-[#FF4761]'
                    }`}
                  >
                    {roiPct >= 0 ? '+' : ''}{roiPct.toFixed(2)}%
                  </span>
                </div>

                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Win Rate</span>
                  <span className="text-xl sm:text-2xl font-extrabold text-[#0BBA74] font-mono mt-1 block tabular-nums">
                    {winRate.toFixed(1)}%
                  </span>
                </div>

                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Max Drawdown</span>
                  <span className="text-xl sm:text-2xl font-extrabold text-rose-400 font-mono mt-1 block tabular-nums">
                    -{Math.abs(maxDd).toFixed(1)}%
                  </span>
                </div>

                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Completed Cycles</span>
                  <span className="text-xl sm:text-2xl font-extrabold text-amber-300 font-mono mt-1 block tabular-nums">
                    {completedCycles}
                  </span>
                </div>

                <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Profit Factor</span>
                  <span className="text-xl sm:text-2xl font-extrabold text-cyan-400 font-mono mt-1 block tabular-nums">
                    {profitFactor.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Sub-Tab 1: Summary & Interactive Equity Curve Preview */}
          {detailTab === 'summary' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 animate-fadeIn">
              {/* Left Column: Metadata and cycle summaries */}
              <div className="lg:col-span-4 bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3 text-sm">
                <h4 className="font-bold text-slate-200 border-b border-[#142033] pb-2 text-base">
                  Run Configuration & Universe
                </h4>
                <div className="space-y-2 text-slate-300">
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-400">Exchange:</span>
                    <strong className="text-amber-400 uppercase font-mono">{activeRun.exchange || 'BYBIT'}</strong>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-400">Symbol Group:</span>
                    <strong className="text-white font-medium">{activeRun.symbolGroupName || 'Symbols'}</strong>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-400">Strategy Engine:</span>
                    <strong className="text-blue-400 font-medium">{activeRun.strategyName || 'Strategy'}</strong>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-400">Timeframe:</span>
                    <strong className="text-white font-mono">{activeRun.timeframeMinutes || 5} minutes</strong>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-400">Total Evaluated Trades:</span>
                    <strong className="text-white font-mono">{activeRun.totalTrades || 0}</strong>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-400">Sharpe Ratio:</span>
                    <strong className="text-[#0BBA74] font-mono">{Number(activeRun.sharpeRatio || 0).toFixed(2)}</strong>
                  </div>
                </div>

                <h4 className="font-bold text-slate-200 border-b border-[#142033] pt-3 pb-2 text-base">
                  Simulation Execution Logs
                </h4>
                <div className="bg-[#171920] rounded-lg p-3 text-xs font-mono text-slate-300 max-h-40 overflow-y-auto space-y-1.5">
                  {(activeRun.logs || []).map((log, i) => (
                    <div key={i} className="leading-tight">
                      • {log}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Visual Equity Curve */}
              <div className="lg:col-span-8 bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#0BBA74] !text-lg">trending_up</span>
                    <span>Cumulative Portfolio Equity Curve (USDT)</span>
                  </h4>
                  <span className="text-xs text-slate-400 font-mono">
                    {(activeRun.equityCurve || []).length} recorded data points
                  </span>
                </div>

                <div className="h-64 w-full relative flex items-center justify-center bg-[#171920] rounded-xl p-2 border border-[#121c2d]">
                  {(activeRun.equityCurve || []).length > 1 ? (
                    <svg className="w-full h-full overflow-visible" viewBox="0 0 600 200" preserveAspectRatio="none">
                      <line x1="0" y1="50" x2="600" y2="50" stroke="#131c2b" strokeWidth="1" />
                      <line x1="0" y1="100" x2="600" y2="100" stroke="#131c2b" strokeWidth="1" />
                      <line x1="0" y1="150" x2="600" y2="150" stroke="#131c2b" strokeWidth="1" />

                      <path
                        d={(() => {
                          const pts = activeRun.equityCurve || [];
                          if (pts.length < 2) return '';
                          const minEq = Math.min(...pts.map((p) => p.equity)) * 0.95;
                          const maxEq = Math.max(...pts.map((p) => p.equity)) * 1.05;
                          const range = Math.max(1, maxEq - minEq);

                          const pathPts = pts.map((p, idx) => {
                            const x = (idx / (pts.length - 1)) * 600;
                            const y = 200 - ((p.equity - minEq) / range) * 180 - 10;
                            return `${x},${y}`;
                          });

                          return `M0,200 L${pathPts.join(' L')} L600,200 Z`;
                        })()}
                        fill="url(#greenGrad)"
                        opacity="0.25"
                      />

                      <path
                        d={(() => {
                          const pts = activeRun.equityCurve || [];
                          if (pts.length < 2) return '';
                          const minEq = Math.min(...pts.map((p) => p.equity)) * 0.95;
                          const maxEq = Math.max(...pts.map((p) => p.equity)) * 1.05;
                          const range = Math.max(1, maxEq - minEq);

                          return pts
                            .map((p, idx) => {
                              const x = (idx / (pts.length - 1)) * 600;
                              const y = 200 - ((p.equity - minEq) / range) * 180 - 10;
                              return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
                            })
                            .join(' ');
                        })()}
                        fill="none"
                        stroke="#0BBA74"
                        strokeWidth="2.5"
                      />

                      <defs>
                        <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0BBA74" stopOpacity="0.8" />
                          <stop offset="100%" stopColor="#0BBA74" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                    </svg>
                  ) : (
                    <span className="text-sm text-slate-500">Generating live equity curve points...</span>
                  )}
                </div>

                <div className="flex items-center justify-between text-sm font-mono text-slate-300 px-2 tabular-nums">
                  <span>Start: ${activeRun.initialCapital.toFixed(2)}</span>
                  <span className="text-[#0BBA74] font-bold text-base">
                    Peak: ${(activeRun.equityCurve && activeRun.equityCurve.length > 0 ? Math.max(...activeRun.equityCurve.map((p) => p.equity)) : activeRun.finalBalance).toFixed(2)}
                  </span>
                  <span>End: ${activeRun.finalBalance.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Sub-Tab 3: Trades Log with 15-16px Table Values */}
          {detailTab === 'trades' && (
            <div className="bg-[#171920] border border-[#152236] rounded-xl p-4 space-y-3 animate-fadeIn">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-bold text-slate-200">
                  Simulated Trade Executions ({activeRun.trades.length} positions)
                </h4>
                <div className="flex items-center gap-2.5">
                  <input
                    type="text"
                    placeholder="Filter symbol..."
                    value={tradeSearch}
                    onChange={(e) => setTradeSearch(e.target.value)}
                    className="bg-[#171920] border border-[#19273c] rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500"
                  />
                  <select
                    value={tradeFilterReason}
                    onChange={(e) => setTradeFilterReason(e.target.value)}
                    className="bg-[#171920] border border-[#19273c] rounded-lg px-3 py-1.5 text-sm text-slate-100"
                  >
                    <option value="all">All Exit Reasons</option>
                    <option value="PNL_DROP_FLOOR">PnL Drop Floor</option>
                    <option value="CYCLE_EXPIRY">Cycle Expiry</option>
                    <option value="MAX_DRAWDOWN">Max Drawdown</option>
                    <option value="BACKTEST_END">Backtest End</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-left font-mono whitespace-nowrap text-sm">
                  <thead>
                    <tr className="border-b border-[#142033] text-xs text-slate-400 uppercase font-semibold">
                      <th className="py-2.5 px-3">Trade ID</th>
                      <th className="py-2.5 px-3">Symbol</th>
                      <th className="py-2.5 px-2 text-center">Side</th>
                      <th className="py-2.5 px-3">Entry Price</th>
                      <th className="py-2.5 px-3">Exit Price</th>
                      <th className="py-2.5 px-3">Notional / Margin</th>
                      <th className="py-2.5 px-3.5 text-right">Net PnL ($)</th>
                      <th className="py-2.5 px-3.5 text-right">PnL (%)</th>
                      <th className="py-2.5 px-3">Exit Reason</th>
                      <th className="py-2.5 px-2 text-center">Cycle #</th>
                      <th className="py-2.5 px-3 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#131d2e] tabular-nums">
                    {activeRun.trades
                      .filter((t) => {
                        if (tradeSearch && !t.symbol.toLowerCase().includes(tradeSearch.toLowerCase())) return false;
                        if (tradeFilterReason !== 'all' && t.exitReason !== tradeFilterReason) return false;
                        return true;
                      })
                      .map((t) => {
                        const isWin = t.pnlUsdt > 0;
                        return (
                          <tr key={t.id} className="hover:bg-[#171920]/40">
                            <td className="py-2.5 px-3 text-slate-400 font-semibold">{t.id}</td>
                            <td className="py-2.5 px-3 font-bold text-white text-base">{t.symbol}</td>
                            <td className="py-2.5 px-2 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-bold ${
                                  t.side === 'BUY'
                                    ? 'bg-emerald-950/40 text-[#0BBA74]'
                                    : 'bg-rose-950/40 text-[#FF4761]'
                                }`}
                              >
                                {t.side}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-200 font-bold">${t.entryPrice}</td>
                            <td className="py-2.5 px-3 text-slate-200 font-bold">{t.exitPrice ? `$${t.exitPrice}` : 'Open'}</td>
                            <td className="py-2.5 px-3 text-slate-300">
                              ${t.notional} ({t.leverage}x) / ${t.margin}
                            </td>
                            <td className={`py-2.5 px-3.5 text-right font-extrabold text-base ${isWin ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                              {isWin ? '+' : ''}${t.pnlUsdt.toFixed(2)}
                            </td>
                            <td className={`py-2.5 px-3.5 text-right font-extrabold text-base ${isWin ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                              {isWin ? '+' : ''}{t.pnlPct.toFixed(1)}%
                            </td>
                            <td className="py-2.5 px-3 text-amber-300 text-xs font-sans">
                              {t.exitReason || 'Active'}
                            </td>
                            <td className="py-2.5 px-2 text-center text-slate-300 font-bold">#{t.cycleIndex}</td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => onInspectTradeOnChart(activeRun.id, t.id)}
                                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
                              >
                                Inspect ↗
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── COMPARISON MODAL ────────────────────────────────────────────── */}
      {showCompareModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#171920] border border-[#1e2838] rounded-2xl max-w-5xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#18263c] pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">compare_arrows</span>
                <span>Comparative Backtest Analysis ({selectedForCompare.length} Runs)</span>
              </h3>
              <button
                onClick={() => setShowCompareModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-[#18263c] text-xs text-slate-400 uppercase">
                    <th className="py-2.5 px-3">Metric</th>
                    {selectedForCompare.map((id) => {
                      const r = runs.find((item) => item.id === id);
                      return (
                        <th key={id} className="py-2.5 px-3 text-center text-blue-400 font-bold">
                          {r ? r.id : id}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#131d2e]">
                  <tr>
                    <td className="py-2.5 px-3 text-slate-400 font-sans">Strategy</td>
                    {selectedForCompare.map((id) => (
                      <td key={id} className="py-2.5 px-3 text-center text-white font-medium">
                        {runs.find((r) => r.id === id)?.strategyName}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-slate-400 font-sans">Net PnL ($)</td>
                    {selectedForCompare.map((id) => {
                      const pnl = runs.find((r) => r.id === id)?.netPnl || 0;
                      return (
                        <td
                          key={id}
                          className={`py-2.5 px-3 text-center font-bold text-base ${
                            pnl >= 0 ? 'text-[#0BBA74]' : 'text-[#FF4761]'
                          }`}
                        >
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-slate-400 font-sans">ROI (%)</td>
                    {selectedForCompare.map((id) => {
                      const roi = runs.find((r) => r.id === id)?.roiPct || 0;
                      return (
                        <td
                          key={id}
                          className={`py-2.5 px-3 text-center font-bold text-base ${
                            roi >= 0 ? 'text-[#0BBA74]' : 'text-[#FF4761]'
                          }`}
                        >
                          {roi >= 0 ? '+' : ''}{roi.toFixed(2)}%
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-slate-400 font-sans">Win Rate</td>
                    {selectedForCompare.map((id) => (
                      <td key={id} className="py-2.5 px-3 text-center text-[#0BBA74] font-bold">
                        {runs.find((r) => r.id === id)?.winRate.toFixed(1)}%
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
