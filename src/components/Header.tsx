import React from 'react';

export type AppPage = 'chart' | 'results' | 'positions' | 'symbols';

interface HeaderProps {
  currentPage: AppPage;
  onPageChange: (page: AppPage) => void;
  activeStrategy: string;
  onStrategyChange: (strategy: string) => void;
  isRunning?: boolean;
  onSaveConfig?: () => void;
  onLoadConfig?: () => void;
  onResetConfig?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  onPageChange,
  activeStrategy,
  onStrategyChange,
  isRunning = false,
  onSaveConfig,
  onLoadConfig,
  onResetConfig
}) => {
  const pages: { id: AppPage; label: string; icon: string; badge?: string }[] = [
    { id: 'chart', label: 'Chart & Backtest', icon: 'candlestick_chart' },
    { id: 'results', label: 'Backtest Results', icon: 'bar_chart' },
    { id: 'positions', label: 'Positions & Charts', icon: 'layers' },
    { id: 'symbols', label: 'Symbol Universe', icon: 'dataset' }
  ];

  return (
    <header className="sticky top-0 z-50 w-full bg-[#101216]/95 backdrop-blur-md border-b border-[#1a2436] px-2 sm:px-4 py-1.5 transition-all">
      <div className="max-w-[1850px] mx-auto grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
        {/* Top/Left Row: Identity & Status */}
        <div className="row-start-2 col-start-1 flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-500 to-yellow-300 flex items-center justify-center text-slate-950 shadow-md shadow-amber-500/20 shrink-0">
              <span className="material-symbols-outlined !font-bold !text-[22px]">vpn_key</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
                  KEYS <span className="text-slate-400 font-semibold">/ Strategy Lab</span>
                </h1>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-400 font-mono">
                  FUTURES PRO
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 tracking-wide font-medium hidden sm:block">
                Multi-Exchange • Pine Script Engine • Cycle Portfolio Backtesting
              </p>
            </div>
          </div>

          {/* Quick status pill on compact screens */}
          <div className="flex 2xl:hidden items-center gap-2">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#171920] border border-[#1a2436] text-xs font-mono">
              {isRunning ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span className="text-amber-300 font-bold uppercase tracking-wide text-[11px]">Running</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span className="text-emerald-400 font-bold uppercase tracking-wide text-[11px]">Ready</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center: Prominent Horizontal Top Navigation (EXACTLY 4 PAGES, NO LEFT SIDEBAR) */}
        <nav
          aria-label="Main Navigation"
          className="row-start-1 col-start-1 sm:col-span-2 flex w-full max-w-full items-center justify-start sm:justify-center overflow-x-auto overflow-y-hidden whitespace-nowrap px-1 gap-5 bg-transparent border-0 border-b border-[#243044] shadow-none"
        >
          {pages.map((p, idx) => {
            const isActive = currentPage === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onPageChange(p.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-1 pt-2 pb-2 text-xs 2xl:text-sm font-bold transition-colors shrink-0 cursor-pointer bg-transparent border-0 border-b-2 -mb-px rounded-none hover:text-[#1463FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1463FF] ${
                  isActive
                    ? 'text-[#1463FF] border-b-[#1463FF]'
                    : 'text-slate-300 border-b-transparent hover:text-[#1463FF]'
                }`}
              >
                <span className="w-4 h-5 flex items-center justify-center text-[11px] font-mono text-current">
                  {idx + 1}
                </span>
                <span className="material-symbols-outlined !text-[18px]">{p.icon}</span>
                <span className="whitespace-nowrap">{p.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: Strategy Controls & Actions */}
        <div className="row-start-3 sm:row-start-2 col-start-1 sm:col-start-2 flex flex-wrap items-center justify-end gap-1.5 min-w-0">
          <div className="hidden lg:flex items-center gap-1.5 text-xs sm:text-sm text-slate-300 font-medium min-w-0">
            <span className="text-slate-400">Strategy:</span>
            <select
              value={activeStrategy}
              onChange={(e) => onStrategyChange(e.target.value)}
              className="bg-[#171920] border border-[#1a2436] rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-semibold text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer max-w-[165px] 2xl:max-w-[200px] truncate"
            >
              <option value="KEYS v6 Liquidity Trap & SAR">KEYS v6 Liquidity Trap</option>
              <option value="KEYS v1 Trend & Momentum">KEYS v1 Trend & Momentum</option>
              <option value="Dynamic VWAP Bands">Dynamic VWAP Bands</option>
              <option value="Custom Pine Script">Custom Pine Script</option>
            </select>
          </div>

          <button
            onClick={onSaveConfig}
            title="Save Configuration Profile"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#1a2436] bg-[#171920] hover:bg-[#121c2d] text-slate-200 text-xs sm:text-sm font-semibold transition cursor-pointer"
          >
            <span className="material-symbols-outlined !text-[16px]">save</span>
            <span className="hidden md:inline">Save</span>
          </button>

          <button
            onClick={onLoadConfig}
            title="Load Configuration Profile"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#1a2436] bg-[#171920] hover:bg-[#121c2d] text-slate-200 text-xs sm:text-sm font-semibold transition cursor-pointer"
          >
            <span className="material-symbols-outlined !text-[16px]">folder_open</span>
            <span className="hidden md:inline">Load</span>
          </button>

          <button
            onClick={onResetConfig}
            title="Reset Defaults"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#1a2436] bg-[#171920] hover:bg-[#121c2d] text-slate-200 text-xs sm:text-sm font-semibold transition cursor-pointer"
          >
            <span className="material-symbols-outlined !text-[16px]">restart_alt</span>
            <span className="hidden md:inline">Reset</span>
          </button>

          <a
            href="/api/download-zip"
            download="keys-strategy-lab-complete.zip"
            title="Download Complete Project ZIP"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-xs sm:text-sm font-semibold transition cursor-pointer"
          >
            <span className="material-symbols-outlined !text-[16px]">download_for_offline</span>
            <span className="hidden sm:inline">ZIP</span>
          </a>

          <div className="hidden 2xl:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#171920] border border-[#1a2436] text-xs font-mono">
            {isRunning ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                <span className="text-amber-300 font-bold uppercase tracking-wide">Running</span>
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                <span className="text-emerald-400 font-bold uppercase tracking-wide">Ready</span>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
