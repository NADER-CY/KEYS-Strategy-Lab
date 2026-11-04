import React from 'react';

export type AppPage = 'chart' | 'results' | 'positions' | 'symbols';

interface HeaderProps {
  currentPage: AppPage;
  onPageChange: (page: AppPage) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentPage, onPageChange }) => {
  const pages: { id: AppPage; label: string; icon: string }[] = [
    { id: 'chart', label: 'Chart & Backtest', icon: 'candlestick_chart' },
    { id: 'results', label: 'Backtest Results', icon: 'bar_chart' },
    { id: 'positions', label: 'Positions & Charts', icon: 'layers' },
    { id: 'symbols', label: 'Symbol Universe', icon: 'dataset' }
  ];

  return (
    <header className="sticky top-0 z-50 w-full bg-[#101216]/95 backdrop-blur-md border-b border-[#243044] px-2 sm:px-4">
      <div className="max-w-[1850px] mx-auto flex flex-wrap lg:flex-nowrap items-center gap-x-6 gap-y-1">
        <div className="flex shrink-0 items-center gap-2.5 py-1.5">
          <img src="/keys-logo.svg" alt="KEYS logo" width={43} height={43} className="h-11 w-11 object-contain shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight text-slate-100">KEYS</span>
              <span className="text-slate-400 text-xs font-semibold">Strategy Lab</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400">FUTURES PRO</span>
            </div>
            <span className="text-[11px] text-slate-400 hidden sm:block">Multi-Exchange · Pine Script Engine · Backtesting</span>
          </div>
        </div>
        <nav aria-label="Main Navigation"
          className="flex min-w-0 flex-1 items-center justify-start lg:justify-center gap-5 overflow-x-auto overflow-y-hidden whitespace-nowrap">
          {pages.map((p) => {
            const isActive = currentPage === p.id;
            return (
              <button key={p.id} type="button"
                onClick={() => onPageChange(p.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-1 pt-3 pb-3 text-xs 2xl:text-sm font-bold transition-colors shrink-0 cursor-pointer bg-transparent border-0 border-b-2 rounded-none hover:text-[#1463FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1463FF] ${isActive ? 'text-[#1463FF] border-b-[#1463FF]' : 'text-slate-300 border-b-transparent hover:text-[#1463FF]'}`}
              >
                <span className="material-symbols-outlined !text-[18px]">{p.icon}</span>
                <span>{p.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
