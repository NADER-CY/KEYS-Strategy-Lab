import React, { useState, useEffect, useMemo } from 'react';
import { ExchangeId, SymbolMeta, SavedSymbolGroup } from '../types';

// Futures chart destinations. Symbols are URL-encoded; links open in another tab.
// TradingView uses the exchange-specific perpetual symbol (.P) when available.
const EXCHANGE_TV_PREFIX: Record<ExchangeId, string> = {
  bybit: 'BYBIT', binance: 'BINANCE', okx: 'OKX', bitget: 'BITGET',
  kucoin: 'KUCOIN', gateio: 'GATEIO', mexc: 'MEXC'
};
const marketLink = (exchange: ExchangeId, symbol: string): string => {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const base = cleaned.endsWith('USDT') ? cleaned.slice(0, -4) : cleaned;
  const quote = 'USDT';
  const pair = `${base}_${quote}`;
  switch (exchange) {
    case 'bybit': return `https://www.bybit.com/trade/usdt/${encodeURIComponent(cleaned)}`;
    case 'binance': return `https://www.binance.com/en/futures/${encodeURIComponent(cleaned)}`;
    case 'okx': return `https://www.okx.com/trade-swap/${encodeURIComponent(base.toLowerCase())}-usdt-swap`;
    case 'bitget': return `https://www.bitget.com/futures/usdt/${encodeURIComponent(cleaned)}`;
    case 'kucoin': return `https://www.kucoin.com/futures/trade/${encodeURIComponent(cleaned + 'M')}`;
    case 'gateio': return `https://www.gate.com/futures/USDT/${encodeURIComponent(pair)}`;
    case 'mexc': return `https://www.mexc.com/futures/${encodeURIComponent(pair)}`;
  }
};
const tradingViewLink = (exchange: ExchangeId, symbol: string): string => {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // TV tickers may differ for unusual contracts. Exchange-specific .P is the common USDT perp convention.
  const tvSymbol = `${EXCHANGE_TV_PREFIX[exchange]}:${cleaned}.P`;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
};

interface SymbolSelectionPageProps {
  currentExchange: ExchangeId;
  onExchangeChange: (ex: ExchangeId) => void;
  savedGroups: SavedSymbolGroup[];
  onSaveGroup: (group: SavedSymbolGroup) => void;
  onDeleteGroup: (id: string) => void;
  onApplyUniverseToBacktest: (groupId: string, autoRun?: boolean) => void;
  onNavigateToPage?: (page: 'chart' | 'results' | 'positions' | 'symbols') => void;
}

export const SymbolSelectionPage: React.FC<SymbolSelectionPageProps> = ({
  currentExchange,
  onExchangeChange,
  savedGroups,
  onSaveGroup,
  onDeleteGroup,
  onApplyUniverseToBacktest,
  onNavigateToPage
}) => {
  const [symbols, setSymbols] = useState<SymbolMeta[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [symbolsError, setSymbolsError] = useState<string>('');
  const [historicalChanges, setHistoricalChanges] = useState<Record<string, Record<string, number | null>>>({});
  const [loadingChanges, setLoadingChanges] = useState(false);

  // Active group selection
  const [activeGroupId, setActiveGroupId] = useState<string>(() => {
    return savedGroups[0]?.id || 'tab_100_bybit';
  });

  const activeGroup = savedGroups.find((g) => g.id === activeGroupId) || savedGroups[0];
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => {
    return activeGroup ? [...activeGroup.symbols] : [];
  });
  const [tabName, setTabName] = useState<string>(activeGroup ? activeGroup.name : 'Tab 1 — 100 Symbols');

  // Filtering & search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSelectedOnly, setShowSelectedOnly] = useState<boolean>(false);
  const [activeChunkTab, setActiveChunkTab] = useState<number>(0); // 100-symbol contract tab
  const [rowsPerPage, setRowsPerPage] = useState<25 | 50 | 75 | 100>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  type SortKey = 'symbol' | 'lastPrice' | 'change24h' | 'fundingRate' | '1H' | '2H' | '4H' | '12H' | '24H' | '48H' | '72H' | '1W' | '1M' | '3M';
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Sync selected symbols when activeGroup changes
  useEffect(() => {
    if (activeGroup) {
      setSelectedSymbols([...activeGroup.symbols]);
      setTabName(activeGroup.name);
      if (activeGroup.exchange !== currentExchange) {
        onExchangeChange(activeGroup.exchange);
      }
    }
  }, [activeGroupId]);

  // Fetch symbol list when exchange changes
  useEffect(() => {
    let isCancelled = false;
    const fetchSymbols = async () => {
      setLoading(true);
      setSymbolsError('');
      setSymbols([]);
      setHistoricalChanges({});
      try {
        const res = await fetch(`/api/symbols?exchange=${currentExchange}`);
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && Array.isArray(data)) {
            // Stable alphabetical sort
            const sorted = [...data].sort((a, b) => a.symbol.localeCompare(b.symbol));
            setSymbols(sorted);
          }
        } else {
          throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        }
      } catch (err: any) {
        if (!isCancelled) setSymbolsError(err.message || 'Symbol list unavailable');
        console.error('Error fetching symbols:', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };
    fetchSymbols();
    return () => {
      isCancelled = true;
    };
  }, [currentExchange]);

  const toggleSymbol = (sym: string) => {
    setSelectedSymbols((prev) => {
      if (prev.includes(sym)) {
        return prev.filter((s) => s !== sym);
      } else {
        return [...prev, sym];
      }
    });
  };

  const handleSelectAll = () => {
    const all = currentChunkSymbols.map((s) => s.symbol);
    const combined = Array.from(new Set([...selectedSymbols, ...all]));
    setSelectedSymbols(combined);
  };

  const handleSelectNone = () => {
    const visibleSet = new Set(currentChunkSymbols.map((s) => s.symbol));
    setSelectedSymbols((prev) => prev.filter((symbol) => !visibleSet.has(symbol)));
  };

  const handleSelectTop = (count: number) => {
    const top = symbols.slice(0, count).map((s) => s.symbol);
    setSelectedSymbols(top);
  };

  const handleSaveChanges = () => {
    if (!activeGroup) return;
    const updated: SavedSymbolGroup = {
      ...activeGroup,
      name: tabName.trim() || activeGroup.name,
      exchange: currentExchange,
      symbols: [...selectedSymbols],
      updatedAt: new Date().toISOString()
    };
    onSaveGroup(updated);
    alert(`Successfully saved ${selectedSymbols.length} symbols to group "${updated.name}"!`);
  };

  const handleApplyToBacktest = (autoRun = false) => {
    if (!activeGroup) return;
    const updated: SavedSymbolGroup = {
      ...activeGroup,
      name: tabName.trim() || activeGroup.name,
      exchange: currentExchange,
      symbols: [...selectedSymbols],
      updatedAt: new Date().toISOString()
    };
    onSaveGroup(updated);
    onApplyUniverseToBacktest(updated.id, autoRun);
  };

  const handleSaveAsNewTab = (copySelection = false) => {
    const newId = `group_${Date.now()}`;
    const nameInput = prompt('Enter a name for the new symbol group:', copySelection ? `${tabName} (Copy)` : 'New USDT Group');
    if (nameInput === null) return;
    const name = nameInput.trim();
    if (!name) { alert('Please enter a group name.'); return; }
    const newGroup: SavedSymbolGroup = {
      id: newId,
      name,
      exchange: currentExchange,
      symbols: copySelection ? [...selectedSymbols] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onSaveGroup(newGroup);
    setActiveGroupId(newId);
    setSelectedSymbols([...newGroup.symbols]);
    setTabName(newGroup.name);
  };

  const handleDuplicateTab = () => {
    if (!activeGroup) return;
    handleSaveAsNewTab(true);
  };

  const handleDeleteTab = () => {
    if (!activeGroup) return;
    if (savedGroups.length <= 1) {
      alert('Cannot delete the last remaining symbol group.');
      return;
    }
    if (confirm(`Are you sure you want to delete symbol group "${activeGroup.name}"?`)) {
      onDeleteGroup(activeGroup.id);
      const remaining = savedGroups.filter((g) => g.id !== activeGroup.id);
      if (remaining.length > 0) {
        setActiveGroupId(remaining[0].id);
        setSelectedSymbols([...remaining[0].symbols]);
        setTabName(remaining[0].name);
      }
    }
  };

  // Filtered universe
  const filteredUniverse = useMemo(() => {
    return symbols.filter((s) => {
      if (showSelectedOnly && !selectedSymbols.includes(s.symbol)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return s.symbol.toLowerCase().includes(q) || s.baseAsset.toLowerCase().includes(q);
      }
      return true;
    });
  }, [symbols, showSelectedOnly, selectedSymbols, searchQuery]);

  // Single searchable and sortable universe; pagination is handled below.
  // Contract-range tabs were redundant and have been removed.
  const currentChunkSymbols = filteredUniverse;

  // Display a single continuous financial table with internal pagination.
  const historicalPeriods = ['1H','2H','4H','12H','24H','48H','72H','1W','1M','3M'] as const;
  const getHistorical = (symbol: string, period: string): number | null => {
    const value = historicalChanges[symbol]?.[period];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const sortedChunkSymbols = useMemo(() => {
    const output = [...currentChunkSymbols];
    output.sort((a, b) => {
      const left = historicalPeriods.includes(sortKey as any) ? getHistorical(a.symbol, sortKey) : (a as any)[sortKey];
      const right = historicalPeriods.includes(sortKey as any) ? getHistorical(b.symbol, sortKey) : (b as any)[sortKey];
      // Unknown values always appear last; never invent missing prices/returns.
      if (left == null || !Number.isFinite(Number(left)) && typeof left !== 'string') return 1;
      if (right == null || !Number.isFinite(Number(right)) && typeof right !== 'string') return -1;
      const result = typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right) : Number(left) - Number(right);
      return sortDirection === 'asc' ? result : -result;
    });
    return output;
  }, [currentChunkSymbols, sortKey, sortDirection, historicalChanges]);

  const pageCount = Math.max(1, Math.ceil(sortedChunkSymbols.length / rowsPerPage));
  const safePage = Math.min(currentPage, pageCount);
  const firstRowIndex = (safePage - 1) * rowsPerPage;
  const pagedSymbols = sortedChunkSymbols.slice(firstRowIndex, firstRowIndex + rowsPerPage);
  const selectedInTab = currentChunkSymbols.filter((symbol) => selectedSymbols.includes(symbol.symbol)).length;
  // Fetch and cache real 1H–3M changes only for the currently displayed rows.
  // Background requests are limited to 25 contracts to avoid rate-limit storms.
  useEffect(() => {
    if (currentExchange !== 'bybit' || pagedSymbols.length === 0) return;
    const ids = pagedSymbols.map((s) => s.symbol).filter((s) => historicalChanges[s] === undefined);
    if (ids.length === 0) return;
    const controller = new AbortController();
    setLoadingChanges(true);
    fetch(`/api/symbols/changes?symbols=${encodeURIComponent(ids.join(','))}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Historical returns HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setHistoricalChanges((old) => ({ ...old, ...data }));
      })
      .catch((err) => { if (!controller.signal.aborted) console.warn(err); })
      .finally(() => { if (!controller.signal.aborted) setLoadingChanges(false); });
    return () => controller.abort();
  }, [currentExchange, pagedSymbols.map((s) => s.symbol).join(',')]);

  const selectPage = (checked: boolean) => {
    const ids = pagedSymbols.map((symbol) => symbol.symbol);
    setSelectedSymbols((previous) => {
      const next = new Set(previous);
      ids.forEach((id) => checked ? next.add(id) : next.delete(id));
      return Array.from(next);
    });
  };
  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDirection((previous) => previous === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('asc'); }
    setCurrentPage(1);
  };

  useEffect(() => { setCurrentPage(1); }, [activeChunkTab, searchQuery, showSelectedOnly, currentExchange]);


  return (
    <div className="space-y-4 pb-12 animate-fadeIn text-[#A6B4C8] [&_.text-white]:text-[#D8E2F0] [&_.text-slate-100]:text-[#D8E2F0] [&_.text-slate-200]:text-[#C5D0DE] [&_.text-slate-300]:text-[#A6B4C8] [&_.text-slate-400]:text-[#8393AA]">
      {/* ─── TOP SECTION: EXCHANGE & SYMBOL GROUP SELECTORS ─────────────── */}
      <section className="bg-transparent border-0 border-b border-[#243044] rounded-none px-0 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="material-symbols-outlined text-blue-400 !text-2xl">dataset</span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">Symbol Universe & Contract Selection</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage cryptocurrency futures symbols, create custom symbol groups, and set backtesting universes
              </p>
            </div>
          </div>

          {/* Real Live Selected Counter Badge */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 bg-[#171920] px-4 py-2 rounded-xl border border-[#19273c]">
              <div className="text-right">
                <span className="text-2xl font-bold font-mono text-[#0BBA74] tabular-nums leading-none block">
                  {selectedSymbols.length}
                </span>
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mt-0.5">
                  Selected Symbols
                </span>
              </div>
              <span className="text-slate-700">|</span>
              <div className="text-right">
                <span className="text-xl font-bold font-mono text-slate-200 tabular-nums leading-none block">
                  {symbols.length}
                </span>
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mt-0.5">
                  Available on {currentExchange.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSaveAsNewTab(true)}
                className="px-3.5 py-2 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <span className="material-symbols-outlined !text-[18px]">add</span>
                <span>New Group</span>
              </button>
              <button
                onClick={handleDuplicateTab}
                className="px-3.5 py-2 rounded-lg bg-[#171920] hover:bg-[#121c2d] border border-[#19273c] text-slate-200 text-sm font-semibold flex items-center space-x-1.5 transition"
              >
                <span className="material-symbols-outlined !text-[18px]">content_copy</span>
                <span>Duplicate</span>
              </button>
              <button
                onClick={handleDeleteTab}
                className="px-3.5 py-2 rounded-lg bg-[#171920] hover:bg-rose-950/40 border border-[#19273c] hover:border-rose-800 text-rose-400 text-sm font-semibold flex items-center space-x-1.5 transition"
              >
                <span className="material-symbols-outlined !text-[18px]">delete</span>
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>

        {/* Two Primary Selectors: Exchange & Saved Symbol Group */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-3">
          <div className="lg:col-span-4">
            <label className="block text-sm font-medium text-slate-300 mb-1">
              1. Cryptocurrency Exchange
            </label>
            <select
              value={currentExchange}
              onChange={(e) => onExchangeChange(e.target.value as ExchangeId)}
              className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-3 py-2 text-base font-semibold text-slate-100 capitalize focus:outline-none focus:border-blue-500 cursor-pointer"
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

          <div className="lg:col-span-5">
            <label className="block text-sm font-medium text-slate-300 mb-1">
              2. Saved Symbol Group (Basket Profile)
            </label>
            <select
              value={activeGroupId}
              onChange={(e) => setActiveGroupId(e.target.value)}
              className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-3 py-2 text-base font-semibold text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {savedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} — {g.symbols.length} symbols ({g.exchange.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-3 flex items-end gap-2">
            <button
              onClick={() => handleApplyToBacktest(false)}
              className="flex-1 px-3 py-2.5 rounded-lg bg-[#0BBA74] hover:bg-emerald-500 text-slate-950 text-sm font-bold flex items-center justify-center space-x-1.5 shadow-md shadow-emerald-500/20 transition active:scale-95"
              title="Apply universe and go to Chart & Backtest"
            >
              <span className="material-symbols-outlined !text-[17px]">settings</span>
              <span>Use in Lab ↗</span>
            </button>
            <button
              onClick={() => handleApplyToBacktest(true)}
              className="flex-1 px-3 py-2.5 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-bold flex items-center justify-center space-x-1.5 shadow-md shadow-blue-500/20 transition active:scale-95"
              title="Save selection and launch backtest immediately"
            >
              <span className="material-symbols-outlined !text-[17px]">play_arrow</span>
              <span>Run Test ⚡</span>
            </button>
          </div>
        </div>

      </section>

      {/* Compact single-line symbol toolbar */}
      <section className="bg-transparent border-0 border-b border-[#243044] px-0 py-2">
        <div className="flex items-center gap-3 whitespace-nowrap overflow-x-auto">
          <div className="relative w-64 shrink-0">
            <input
              type="text"
              placeholder="Search symbol (BTC, SOL, PEPE, SUI)..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setActiveChunkTab(0);
              }}
              className="w-full bg-[#171920] border border-[#19273c] rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1.5 text-slate-400 hover:text-[#1463FF] text-xs">✕</button>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <label className="flex shrink-0 items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-300">
              <input type="checkbox" checked={showSelectedOnly}
                onChange={(e) => { setShowSelectedOnly(e.target.checked); setActiveChunkTab(0); }}
                className="w-4 h-4 rounded border-slate-700 text-blue-600 bg-slate-900 cursor-pointer" />
              Show Selected Only ({selectedSymbols.length})
            </label>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-xs font-semibold text-slate-400">Select:</span>
            <button onClick={handleSelectAll}
              className="px-2.5 py-1.5 rounded-lg bg-[#171920] border border-[#19273c] text-xs font-semibold text-slate-200 hover:text-[#1463FF]">
              Select All ({currentChunkSymbols.length})
            </button>
            <button onClick={handleSelectNone}
              className="px-2.5 py-1.5 rounded-lg bg-[#171920] border border-[#19273c] text-xs font-semibold text-slate-200 hover:text-[#1463FF]">
              Clear Tab ({selectedInTab})
            </button>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-xs font-semibold text-slate-400">Quick:</span>
            <button onClick={() => handleSelectTop(50)}
              className="px-2.5 py-1.5 rounded-lg bg-[#171920] border border-[#19273c] text-xs font-bold text-amber-300 hover:text-[#1463FF]">Top 50</button>
            <button onClick={() => handleSelectTop(100)}
              className="px-2.5 py-1.5 rounded-lg bg-[#171920] border border-[#19273c] text-xs font-bold text-amber-300 hover:text-[#1463FF]">Top 100</button>
            <button onClick={() => setSelectedSymbols(activeGroup ? [...activeGroup.symbols] : [])}
              className="px-2.5 py-1.5 rounded-lg bg-[#171920] border border-[#19273c] text-xs font-medium text-slate-400 hover:text-[#1463FF]">Reset Group</button>
          </div>
        </div>
      </section>

      {/* Compact full-width table: neutral background, no outer border or horizontal scrolling. */}
      <section className="min-w-0 w-full bg-transparent border-0 border-b border-[#243044] rounded-none px-0 py-4 space-y-3">
        <div className="text-sm font-semibold text-[#D8E2F0]">Futures Contracts</div>
        {symbolsError && <div className="p-4 text-rose-400 font-semibold" role="alert">{symbolsError}</div>}
        {loadingChanges && currentExchange === 'bybit' && <div className="text-xs text-slate-400">Loading historical returns from Bybit...</div>}
        {loading ? <div className="p-8 text-center text-slate-300">Loading contracts...</div> : (
          <div className="w-full min-w-0 max-w-full overflow-x-hidden bg-transparent border-0">
            <table className="w-full min-w-0 table-fixed border-collapse text-left tabular-nums text-[clamp(11px,0.88vw,14px)]">
              <colgroup>
                {/* Compact symbol/price columns; no category column. Total 100%. */}
                <col style={{width:'3%'}} />
                <col style={{width:'9%'}} />
                <col style={{width:'9%'}} />
                {Array.from({length:10}).map((_,i)=><col key={i} style={{width:'6.7%'}} />)}
                <col style={{width:'12%'}} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-[#101216] text-slate-400 border-b border-white/[0.06]">
                <tr>
                  <th className="px-1 py-2.5 text-center">
                    <input type="checkbox" aria-label="Select all visible rows"
                      checked={pagedSymbols.length > 0 && pagedSymbols.every((symbol) => selectedSymbols.includes(symbol.symbol))}
                      onChange={(event) => selectPage(event.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 text-blue-600 bg-slate-900 cursor-pointer" />
                  </th>
                  <th className="pl-1.5 pr-0 py-2.5 cursor-pointer" onClick={() => toggleSort('symbol')}>Symbol ↕</th>
                  <th className="pl-0 pr-2 py-2.5 text-right cursor-pointer" onClick={() => toggleSort('lastPrice')}>Last Price ↕</th>
                  {historicalPeriods.map((period) => (
                    <th key={period} className="px-0.5 py-2.5 text-right cursor-pointer"
                      onClick={() => toggleSort(period)}>{period} % ↕</th>
                  ))}
                  <th className="px-1 py-2.5 text-right cursor-pointer" onClick={() => toggleSort('fundingRate')}>Funding ↕</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {pagedSymbols.map((symbol) => {
                  const checked = selectedSymbols.includes(symbol.symbol);
                  return (
                    <tr key={symbol.symbol} onClick={() => toggleSymbol(symbol.symbol)}
                      className="cursor-pointer bg-transparent hover:bg-white/[0.025] transition-colors">
                      <td className="px-1 py-2.5 text-center" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={checked} onChange={() => toggleSymbol(symbol.symbol)}
                          aria-label={`Select ${symbol.symbol}`}
                          className="w-4 h-4 rounded border-slate-600 text-blue-600 bg-slate-900 cursor-pointer" />
                      </td>
                      <td className="pl-1.5 pr-0 py-1.5">
                        <div className="flex items-center gap-1 min-w-0">
                          <span title={symbol.symbol} className="truncate font-bold text-slate-200 text-[clamp(12px,0.95vw,15px)]">{symbol.symbol}</span>
                          <a href={marketLink(currentExchange, symbol.symbol)} target="_blank" rel="noopener noreferrer"
                             title={`Open ${symbol.symbol} futures on ${currentExchange}`} aria-label={`Open ${symbol.symbol} futures on ${currentExchange}`}
                             onClick={(event) => event.stopPropagation()}
                             className="shrink-0 text-slate-400 hover:text-sky-400 inline-flex items-center justify-center" >
                            <span className="material-symbols-outlined !text-[15px]">open_in_new</span>
                          </a>
                          <a href={tradingViewLink(currentExchange, symbol.symbol)} target="_blank" rel="noopener noreferrer"
                             title={`Open ${symbol.symbol} on TradingView`} aria-label={`Open ${symbol.symbol} on TradingView`}
                             onClick={(event) => event.stopPropagation()}
                             className="shrink-0 text-slate-400 hover:text-sky-400 inline-flex items-center justify-center">
                            <span className="material-symbols-outlined !text-[15px]">launch</span>
                          </a>
                        </div>
                        <div className="mt-0.5 text-[clamp(12px,0.87vw,14px)] leading-tight font-semibold text-slate-300">
                          {Number.isFinite(symbol.maxLeverage) && symbol.maxLeverage > 0 ? `${symbol.maxLeverage}×` : 'Leverage —'}
                        </div>
                      </td>
                      <td className="pl-0 pr-1 py-2.5 text-right font-bold text-slate-200 text-[clamp(15px,1.16vw,19px)] truncate" title={String(symbol.lastPrice)}>
                        {Number.isFinite(symbol.lastPrice) && symbol.lastPrice > 0 ? symbol.lastPrice.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'}
                      </td>
                      {historicalPeriods.map((period) => {
                        const value = getHistorical(symbol.symbol, period);
                        const change = period === '24H' && value === null && Number.isFinite(symbol.change24h)
                          ? symbol.change24h : value;
                        return (
                          <td key={period} className={`px-0.5 py-2.5 text-right font-semibold truncate ${change === null ? 'text-slate-500' : change >= 0 ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                            {change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                          </td>
                        );
                      })}
                      <td className="px-1 py-2.5 text-right text-[#F59E0B] font-semibold truncate">{typeof symbol.fundingRate === 'number' && Number.isFinite(symbol.fundingRate) ? `${symbol.fundingRate.toFixed(4)}%` : '—'}</td>
                    </tr>
                  );
                })}
                {pagedSymbols.length === 0 && <tr><td colSpan={14} className="p-8 text-center text-slate-400">No matching symbols</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {/* Centered selection total and page-size controls below the table */}
        <div className="flex flex-wrap items-center justify-center gap-4 border-t border-[#243044] pt-3 text-sm">
          <span className="text-slate-300 font-semibold tabular-nums">{selectedSymbols.length} selected</span>
          <span className="text-slate-400">Rows:</span>
          {([25, 50, 75, 100] as const).map((count) => (
            <button key={count} type="button"
              onClick={() => { setRowsPerPage(count); setCurrentPage(1); }}
              aria-pressed={rowsPerPage === count}
              className={`bg-transparent border-0 px-0 py-1 text-sm font-bold tabular-nums transition-colors hover:text-[#1463FF] ${rowsPerPage === count ? 'text-[#1463FF]' : 'text-slate-400'}`}>
              {count}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm">
          <span className="text-slate-300 tabular-nums">
            {sortedChunkSymbols.length === 0 ? 0 : firstRowIndex + 1}–{Math.min(firstRowIndex + rowsPerPage, sortedChunkSymbols.length)} of {sortedChunkSymbols.length} symbols
            <span className="text-slate-500 ml-2">(total {filteredUniverse.length} matching exchange symbols)</span>
          </span>
          <div className="flex items-center gap-3 font-semibold">
            <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safePage === 1} className="disabled:opacity-30 text-slate-300 hover:text-white">Previous</button>
            <span className="text-[#1463FF] tabular-nums">Page {safePage} of {pageCount}</span>
            <button type="button" onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              disabled={safePage === pageCount} className="disabled:opacity-30 text-slate-300 hover:text-white">Next</button>
          </div>
        </div>

        {/* Bottom Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3">
          <div className="flex items-center space-x-3">
            <span className="text-sm font-semibold text-slate-300">Group Name:</span>
            <input
              type="text"
              value={tabName}
              onChange={(e) => setTabName(e.target.value)}
              className="bg-[#171920] border border-[#19273c] rounded-lg px-3 py-1.5 text-base text-white font-bold w-72 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleSaveChanges}
              className="px-5 py-2.5 rounded-lg bg-[#1463FF] hover:bg-blue-600 text-white text-sm font-bold flex items-center space-x-2 shadow-sm transition"
            >
              <span className="material-symbols-outlined !text-[18px]">save</span>
              <span>Save Selection to Group</span>
            </button>

            <button
              onClick={handleSaveAsNewTab}
              className="px-4 py-2.5 rounded-lg bg-[#171920] hover:bg-[#121c2d] border border-[#19273c] text-slate-200 text-sm font-semibold flex items-center space-x-1.5 transition"
            >
              <span className="material-symbols-outlined !text-[18px]">add_circle</span>
              <span>Save As New Group</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
