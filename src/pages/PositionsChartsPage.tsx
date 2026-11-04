import React, { useState, useEffect } from 'react';
import { CandlestickChart } from '../components/CandlestickChart';
import { BacktestRun, PositionTrade, OHLCV } from '../types';

interface PositionsChartsPageProps {
  runs: BacktestRun[];
  selectedRunId?: string;
  onSelectRun: (id: string) => void;
  inspectTradeId?: string | null;
  onNewBacktest?: () => void;
  onTestSymbolOnChart?: (symbol: string) => void;
  onNavigateToPage?: (page: 'chart' | 'results' | 'positions' | 'symbols') => void;
}

export const PositionsChartsPage: React.FC<PositionsChartsPageProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  inspectTradeId,
  onNewBacktest,
  onTestSymbolOnChart,
  onNavigateToPage
}) => {
  // Prefer run with trades if active has none, or explicitly selected
  const activeRun =
    (selectedRunId ? runs.find((r) => r.id === selectedRunId) : null) ||
    runs.find((r) => r.trades && r.trades.length > 0) ||
    runs[0];

  const trades = activeRun?.trades || [];

  const [selectedTrade, setSelectedTrade] = useState<PositionTrade | null>(null);
  const [filterSymbol, setFilterSymbol] = useState<string>('all');
  const [filterSide, setFilterSide] = useState<string>('all');
  const [filterOutcome, setFilterOutcome] = useState<string>('all');
  const [filterCycle, setFilterCycle] = useState<string>('all');
  const [tradeCandles, setTradeCandles] = useState<OHLCV[]>([]);
  const [loadingChart, setLoadingChart] = useState<boolean>(false);

  // Auto-select inspect trade or first available trade
  useEffect(() => {
    if (trades.length > 0) {
      if (inspectTradeId) {
        const found = trades.find((t) => t.id === inspectTradeId);
        if (found) {
          setSelectedTrade(found);
          return;
        }
      }
      if (!selectedTrade || !trades.some((t) => t.id === selectedTrade.id)) {
        setSelectedTrade(trades[0]);
      }
    } else {
      setSelectedTrade(null);
    }
  }, [activeRun?.id, inspectTradeId, trades.length]);

  // Fetch candles for selected trade
  useEffect(() => {
    if (!selectedTrade || !activeRun) return;

    let isCancelled = false;
    const loadCandles = async () => {
      setLoadingChart(true);
      try {
        const res = await fetch(
          `/api/candles?exchange=${activeRun.exchange}&symbol=${selectedTrade.symbol}&timeframe=${activeRun.timeframeMinutes}&limit=400`
        );
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && Array.isArray(data)) {
            setTradeCandles(data);
          }
        }
      } catch (err) {
        console.error('Error fetching trade candles:', err);
      } finally {
        if (!isCancelled) setLoadingChart(false);
      }
    };

    loadCandles();
    return () => {
      isCancelled = true;
    };
  }, [selectedTrade?.id, selectedTrade?.symbol, activeRun?.exchange]);

  if (!activeRun) {
    return (
      <div className="p-8 text-center bg-[#171920] border border-[#172338] rounded-xl text-slate-300 text-base space-y-4">
        <p>No completed backtest runs found in the system.</p>
        <button
          onClick={onNewBacktest}
          className="px-4 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white font-bold text-sm inline-flex items-center gap-2 cursor-pointer shadow-md"
        >
          <span className="material-symbols-outlined !text-[18px]">play_arrow</span>
          <span>Launch Your First Backtest in Chart Lab ⚡</span>
        </button>
      </div>
    );
  }

  // Filter positions
  const filteredTrades = trades.filter((t) => {
    if (filterSymbol !== 'all' && t.symbol !== filterSymbol) return false;
    if (filterSide !== 'all' && t.side !== filterSide) return false;
    if (filterOutcome === 'win' && t.pnlUsdt <= 0) return false;
    if (filterOutcome === 'loss' && t.pnlUsdt > 0) return false;
    if (filterCycle !== 'all' && t.cycleIndex !== parseInt(filterCycle)) return false;
    return true;
  });

  // Calculate statistics
  const totalPositions = trades.length;
  const wins = trades.filter((t) => t.pnlUsdt > 0);
  const winRate = totalPositions > 0 ? ((wins.length / totalPositions) * 100).toFixed(1) : '0';
  const avgPnl = totalPositions > 0
    ? (trades.reduce((sum, t) => sum + t.pnlUsdt, 0) / totalPositions).toFixed(2)
    : '0';

  const bestTrade = trades.length > 0
    ? trades.reduce((max, t) => (t.pnlUsdt > (max?.pnlUsdt || -Infinity) ? t : max), trades[0])
    : null;
  const worstTrade = trades.length > 0
    ? trades.reduce((min, t) => (t.pnlUsdt < (min?.pnlUsdt || Infinity) ? t : min), trades[0])
    : null;

  // Unique symbols and cycles in trades
  const uniqueSymbols = Array.from(new Set(trades.map((t) => t.symbol)));
  const uniqueCycles = Array.from(new Set(trades.map((t) => t.cycleIndex))).sort((a, b) => a - b);

  return (
    <div className="space-y-4 pb-12 animate-fadeIn">
      {/* ─── QUICK PAGE SWITCHER ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="text-slate-500">PAGE 3 OF 4:</span>
          <span className="text-white font-bold flex items-center gap-1">
            <span className="material-symbols-outlined !text-[16px] text-purple-400">layers</span>
            Simulated Positions & Trade Charts
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
              onClick={() => onNavigateToPage('results')}
              className="px-2.5 py-1 rounded-lg bg-[#171920] hover:bg-[#15233a] border border-[#172338] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer transition"
            >
              <span className="material-symbols-outlined !text-[14px]">bar_chart</span>
              <span>2. Backtest Results ↗</span>
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

      {/* ─── HEADER & RUN PICKER ────────────────────────────────────────── */}
      <section className="bg-[#171920] border border-[#172338] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="material-symbols-outlined text-purple-400 !text-2xl">layers</span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                Simulated Positions & Trade Entry/Exit Charts
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Inspect every position entry candle, exit reason, and individual contract chart
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-300">Select Backtest Run:</span>
            <select
              value={activeRun.id}
              onChange={(e) => onSelectRun(e.target.value)}
              className="bg-[#171920] border border-[#19273c] text-sm font-bold text-white rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 font-mono cursor-pointer"
            >
              {runs.map((r) => {
                const pnl = Number(r.netPnl || 0);
                const ex = (r.exchange || 'BYBIT').toUpperCase();
                const strat = r.strategyName || 'Strategy';
                const tradeCount = r.trades ? r.trades.length : 0;
                return (
                  <option key={r.id} value={r.id}>
                    {r.id} — {strat} ({ex}, {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} • {tradeCount} trades)
                  </option>
                );
              })}
            </select>

            {onNewBacktest && (
              <button
                onClick={onNewBacktest}
                className="px-3.5 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-bold flex items-center space-x-1.5 shadow-sm transition cursor-pointer"
              >
                <span className="material-symbols-outlined !text-[17px]">add</span>
                <span>+ New Backtest</span>
              </button>
            )}
          </div>
        </div>

        {/* Metric Cards Row — 20–24px Primary Values */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-[#142033]">
          <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Total Positions</span>
            <span className="text-xl sm:text-2xl font-extrabold text-white font-mono mt-1 block tabular-nums">
              {totalPositions}
            </span>
          </div>

          <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Win Rate</span>
            <span className="text-xl sm:text-2xl font-extrabold text-[#0BBA74] font-mono mt-1 block tabular-nums">
              {winRate}%
            </span>
          </div>

          <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Avg Trade PnL</span>
            <span
              className={`text-xl sm:text-2xl font-extrabold font-mono mt-1 block tabular-nums ${
                Number(avgPnl) >= 0 ? 'text-[#0BBA74]' : 'text-[#FF4761]'
              }`}
            >
              {Number(avgPnl) >= 0 ? '+' : ''}${avgPnl}
            </span>
          </div>

          <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Best Trade</span>
            <span className="text-xl sm:text-2xl font-extrabold text-[#0BBA74] font-mono mt-1 block tabular-nums truncate">
              {bestTrade ? `+${bestTrade.pnlPct}%` : '—'}
            </span>
          </div>

          <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Worst Trade</span>
            <span className="text-xl sm:text-2xl font-extrabold text-[#FF4761] font-mono mt-1 block tabular-nums truncate">
              {worstTrade ? `${worstTrade.pnlPct}%` : '—'}
            </span>
          </div>

          <div className="bg-[#171920] border border-[#152236] rounded-xl p-3 text-center">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Cycles</span>
            <span className="text-xl sm:text-2xl font-extrabold text-amber-300 font-mono mt-1 block tabular-nums">
              {activeRun.completedCycles}
            </span>
          </div>
        </div>
      </section>

      {/* If no trades in this run */}
      {trades.length === 0 && (
        <section className="bg-[#171920] border border-[#172338] rounded-xl p-8 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <span className="material-symbols-outlined !text-3xl">info</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">No Filled Positions in Run {activeRun.id}</h3>
            <p className="text-sm text-slate-400 max-w-xl mx-auto mt-1">
              This backtest simulation finished with 0 trade executions because no candle sequences met the strict simultaneous BUY/SELL and SAR criteria during this period.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {runs.find((r) => r.trades && r.trades.length > 0) && (
              <button
                onClick={() => {
                  const target = runs.find((r) => r.trades && r.trades.length > 0);
                  if (target) onSelectRun(target.id);
                }}
                className="px-4 py-2 rounded-lg bg-[#0BBA74] hover:bg-emerald-500 text-slate-950 font-bold text-sm flex items-center gap-2 cursor-pointer shadow-md"
              >
                <span className="material-symbols-outlined !text-[18px]">visibility</span>
                <span>
                  Switch to {runs.find((r) => r.trades && r.trades.length > 0)?.id} ({runs.find((r) => r.trades && r.trades.length > 0)?.trades.length} positions) ↗
                </span>
              </button>
            )}
            {onNewBacktest && (
              <button
                onClick={onNewBacktest}
                className="px-4 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white font-bold text-sm flex items-center gap-2 cursor-pointer shadow-md"
              >
                <span className="material-symbols-outlined !text-[18px]">play_arrow</span>
                <span>Run New Backtest in Chart Lab ⚡</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* ─── DEDICATED POSITION CANDLESTICK CHART (Desktop Height: 520px) ─── */}
      {selectedTrade && (
        <section className="bg-[#171920] border border-[#172338] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 font-mono text-sm font-bold">
                {selectedTrade.id}
              </span>
              <span className="text-base font-extrabold text-white tracking-wide">
                {selectedTrade.symbol} ({selectedTrade.side})
              </span>
              <span
                className={`text-sm font-bold font-mono px-2.5 py-1 rounded-lg tabular-nums ${
                  Number(selectedTrade.pnlUsdt || 0) >= 0
                    ? 'bg-emerald-950/40 text-[#0BBA74] border border-emerald-800/40'
                    : 'bg-rose-950/40 text-[#FF4761] border border-rose-800/40'
                }`}
              >
                {Number(selectedTrade.pnlUsdt || 0) >= 0 ? '+' : ''}${Number(selectedTrade.pnlUsdt || 0).toFixed(2)} ({Number(selectedTrade.pnlPct || 0) > 0 ? '+' : ''}${Number(selectedTrade.pnlPct || 0).toFixed(1)}%)
              </span>
              {onTestSymbolOnChart && (
                <button
                  onClick={() => onTestSymbolOnChart(selectedTrade.symbol)}
                  className="px-2.5 py-1 rounded-lg bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40 text-xs font-bold flex items-center gap-1 transition"
                  title={`Open ${selectedTrade.symbol} on Chart & Backtest`}
                >
                  <span className="material-symbols-outlined !text-[14px]">show_chart</span>
                  <span>Test in Chart Lab ↗</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm font-mono text-slate-300 tabular-nums">
              <span>
                Entry: <strong className="text-white">${selectedTrade.entryPrice}</strong>{' '}
                <span className="text-slate-500 text-xs">
                  ({new Date(selectedTrade.entryTime * 1000).toISOString().replace('T', ' ').slice(0, 16)})
                </span>
              </span>
              <span className="text-slate-600">•</span>
              <span>
                Exit: <strong className="text-white">${selectedTrade.exitPrice || '—'}</strong>{' '}
                {selectedTrade.exitTime && (
                  <span className="text-slate-500 text-xs">
                    ({new Date(selectedTrade.exitTime * 1000).toISOString().replace('T', ' ').slice(0, 16)})
                  </span>
                )}
              </span>
              <span className="text-slate-600">•</span>
              <span>
                Notional: <strong className="text-[#0BBA74]">${selectedTrade.notional}</strong> ({selectedTrade.leverage}x)
              </span>
              <span className="text-slate-600">•</span>
              <span>
                Exit Trigger: <strong className="text-amber-300">{selectedTrade.exitReason}</strong>
              </span>
            </div>
          </div>

          {/* Trade Candlestick Chart */}
          <div className="w-full">
            <CandlestickChart
              symbol={selectedTrade.symbol}
              candles={tradeCandles}
              selectedTrade={selectedTrade}
              timeframeMinutes={activeRun.timeframeMinutes}
              height={520}
              showIndicators={false}
            />
          </div>
        </section>
      )}

      {/* ─── POSITIONS MASTER TABLE & FILTERS ───────────────────────────── */}
      <section className="bg-[#171920] border border-[#172338] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>All Simulated Positions ({filteredTrades.length})</span>
          </h3>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              value={filterSymbol}
              onChange={(e) => setFilterSymbol(e.target.value)}
              className="bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-slate-200"
            >
              <option value="all">All Symbols ({uniqueSymbols.length})</option>
              {uniqueSymbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={filterSide}
              onChange={(e) => setFilterSide(e.target.value)}
              className="bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-slate-200"
            >
              <option value="all">All Sides</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>

            <select
              value={filterOutcome}
              onChange={(e) => setFilterOutcome(e.target.value)}
              className="bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-slate-200"
            >
              <option value="all">All Outcomes</option>
              <option value="win">Winners Only</option>
              <option value="loss">Losers Only</option>
            </select>

            <select
              value={filterCycle}
              onChange={(e) => setFilterCycle(e.target.value)}
              className="bg-[#171920] border border-[#19273c] rounded-lg px-2.5 py-1.5 text-slate-200"
            >
              <option value="all">All Cycles ({uniqueCycles.length})</option>
              {uniqueCycles.map((c) => (
                <option key={c} value={c}>
                  Cycle #{c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Master Positions Table — 15-16px Table Numbers */}
        <div className="overflow-x-auto bg-[#171920] border border-[#172338] rounded-xl max-h-[520px]">
          <table className="w-full text-left font-mono whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-[#171920] border-b border-[#172338]">
              <tr className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3 px-3">Trade ID</th>
                <th className="py-3 px-3">Symbol</th>
                <th className="py-3 px-2 text-center">Side</th>
                <th className="py-3 px-3">Entry Time</th>
                <th className="py-3 px-3">Entry Price</th>
                <th className="py-3 px-3">Exit Time</th>
                <th className="py-3 px-3">Exit Price</th>
                <th className="py-3 px-3">Notional</th>
                <th className="py-3 px-2 text-center">Lev</th>
                <th className="py-3 px-3">Margin</th>
                <th className="py-3 px-3.5 text-right">Net PnL ($)</th>
                <th className="py-3 px-3.5 text-right">PnL (%)</th>
                <th className="py-3 px-3">Exit Reason</th>
                <th className="py-3 px-2 text-center">Cycle</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#131d2e] tabular-nums">
              {filteredTrades.map((t) => {
                const isSelected = selectedTrade?.id === t.id;
                const isWin = t.pnlUsdt > 0;

                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTrade(t)}
                    className={`cursor-pointer transition ${
                      isSelected
                        ? 'bg-blue-950/40 border-l-4 border-l-[#1463FF]'
                        : 'hover:bg-[#171920]/50'
                    }`}
                  >
                    <td className="py-3 px-3 text-blue-400 font-semibold">{t.id}</td>
                    <td className="py-3 px-3 font-extrabold text-white text-base">{t.symbol}</td>
                    <td className="py-3 px-2 text-center">
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
                    <td className="py-3 px-3 text-slate-300 text-xs">
                      {new Date(t.entryTime * 1000).toISOString().replace('T', ' ').slice(0, 16)}
                    </td>
                    <td className="py-3 px-3 text-slate-100 font-bold">${t.entryPrice}</td>
                    <td className="py-3 px-3 text-slate-300 text-xs">
                      {t.exitTime ? new Date(t.exitTime * 1000).toISOString().replace('T', ' ').slice(0, 16) : 'Active'}
                    </td>
                    <td className="py-3 px-3 text-slate-100 font-bold">{t.exitPrice ? `$${t.exitPrice}` : 'Open'}</td>
                    <td className="py-3 px-3 text-slate-300">${t.notional}</td>
                    <td className="py-3 px-2 text-center text-amber-400 font-bold">{t.leverage}x</td>
                    <td className="py-3 px-3 text-slate-300">${t.margin}</td>
                    <td className={`py-3 px-3.5 text-right font-extrabold text-base ${isWin ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                      {isWin ? '+' : ''}${Number(t.pnlUsdt || 0).toFixed(2)}
                    </td>
                    <td className={`py-3 px-3.5 text-right font-extrabold text-base ${isWin ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                      {isWin ? '+' : ''}{Number(t.pnlPct || 0).toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-amber-300 text-xs font-sans">{t.exitReason || 'Active'}</td>
                    <td className="py-3 px-2 text-center text-slate-300 font-bold">#{t.cycleIndex}</td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTrade(t);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-[#15233a] text-slate-200 hover:text-white'
                        }`}
                      >
                        {isSelected ? 'Viewing' : 'View Chart'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
