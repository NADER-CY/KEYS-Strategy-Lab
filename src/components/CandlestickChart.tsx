import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  CandlestickData,
  LineData,
  SeriesMarker,
  Time
} from 'lightweight-charts';
import { OHLCV, IndicatorSignals, PositionTrade } from '../types';

interface CandlestickChartProps {
  symbol: string;
  onSymbolChange?: (symbol: string) => void;
  availableSymbols?: string[];
  candles: OHLCV[];
  signals?: IndicatorSignals;
  selectedTrade?: PositionTrade | null;
  timeframeMinutes?: number;
  onTimeframeChange?: (tf: number) => void;
  height?: number;
  showIndicators?: boolean;
  isLive?: boolean;
  onToggleLive?: () => void;
  lastUpdated?: Date | null;
  onRefresh?: () => void;
  candleType?: 'regular' | 'heikin_ashi' | 'renko';
  onCandleTypeChange?: (type: 'regular' | 'heikin_ashi' | 'renko') => void;
  loading?: boolean;
}

type SignalBadge = { key: string; side: 'BUY' | 'SELL'; left: number; top: number; price: string };

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  onSymbolChange,
  availableSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'],
  candles,
  signals,
  selectedTrade,
  timeframeMinutes = 5,
  onTimeframeChange,
  height = 520,
  showIndicators: showIndicatorsProp = false,
  isLive = true,
  onToggleLive,
  lastUpdated,
  onRefresh,
  candleType,
  onCandleTypeChange,
  loading = false
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRootRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const markerPluginRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const lineSeriesMapRef = useRef<Map<string, ISeriesApi<any>>>(new Map());
  const candlesRef = useRef<OHLCV[]>(candles);
  const candleLookupRef = useRef<Map<number, OHLCV>>(new Map());
  const plottedCandlesRef = useRef<OHLCV[]>([]);
  const prevSymbolRef = useRef<string>(symbol);
  const prevTfRef = useRef<number>(timeframeMinutes);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showJumpToLive, setShowJumpToLive] = useState(false);
  const [hoveredCandle, setHoveredCandle] = useState<OHLCV | null>(null);
  const [showIndicators, setShowIndicators] = useState<boolean>(showIndicatorsProp);
  const [signalBadges, setSignalBadges] = useState<SignalBadge[]>([]);
  const badgeSignalsRef = useRef<IndicatorSignals | undefined>(signals);
  const badgePrecisionRef = useRef(6);
  const badgeFrameRef = useRef<number | null>(null);

  const updateSignalBadges = () => {
    if (badgeFrameRef.current !== null) return;
    badgeFrameRef.current = requestAnimationFrame(() => {
      badgeFrameRef.current = null;
      const chart = chartApiRef.current;
      const series = candleSeriesRef.current;
      const canvas = chartContainerRef.current;
      const visible = chart?.timeScale().getVisibleRange();
      if (!chart || !series || !canvas || !visible || !badgeSignalsRef.current) {
        setSignalBadges((previous) => previous.length ? [] : previous);
        return;
      }
      const lowTime = Number(visible.from);
      const highTime = Number(visible.to);
      const next: SignalBadge[] = [];
      const renderSide = (items: IndicatorSignals['buySignals'], side: 'BUY' | 'SELL') => {
        for (const signal of items) {
          if (signal.time < lowTime || signal.time > highTime) continue;
          const candle = candleLookupRef.current.get(signal.time);
          if (!candle) continue;
          const x = chart.timeScale().timeToCoordinate(signal.time as Time);
          const y = series.priceToCoordinate(side === 'BUY' ? candle.low : candle.high);
          if (x === null || y === null || x < 55 || x > canvas.clientWidth - 85) continue;
          next.push({
            key: `${side}-${signal.time}`,
            side,
            left: x,
            top: side === 'BUY' ? y + 18 : y - 18,
            price: signal.price.toFixed(badgePrecisionRef.current)
          });
          if (next.length >= 80) return;
        }
      };
      renderSide(badgeSignalsRef.current.buySignals, 'BUY');
      if (next.length < 80) renderSide(badgeSignalsRef.current.sellSignals, 'SELL');
      setSignalBadges(next);
    });
  };

  useEffect(() => {
    if (!isFullscreen) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', exitOnEscape);
    return () => document.removeEventListener('keydown', exitOnEscape);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const root = chartRootRef.current;
    if (root?.requestFullscreen && document.fullscreenElement !== root) {
      void root.requestFullscreen().catch(() => {
        // Keep the full-viewport portal fallback if browser fullscreen is blocked.
      });
    }
    const syncExit = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', syncExit);
    return () => {
      document.removeEventListener('fullscreenchange', syncExit);
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
    };
  }, [isFullscreen]);

  const timeframes = [
    ...Array.from({ length: 12 }, (_, i) => ({ label: (i + 1) * 5 === 60 ? '1h' : `${(i + 1) * 5}m`, minutes: (i + 1) * 5 })),
    { label: '2h', minutes: 120 },
    { label: '4h', minutes: 240 },
    { label: '1D', minutes: 1440 },
    { label: '1W', minutes: 10080 },
    { label: '1M', minutes: 43200 }
  ];

  // 1. Initialize Lightweight Charts instance ONCE on container mount or resize
  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (chartApiRef.current) {
      chartApiRef.current.remove();
      chartApiRef.current = null;
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: isFullscreen ? Math.max(300, window.innerHeight - 125) : height,
      layout: {
        background: { color: '#171920' },
        textColor: '#94a3b8'
      },
      grid: {
        vertLines: { color: '#30394a', visible: true },
        horzLines: { color: '#30394a', visible: true }
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#334155',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b'
        },
        horzLine: {
          color: '#334155',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b'
        }
      },
      rightPriceScale: {
        borderColor: '#1a2436',
        scaleMargins: {
          top: 0.1,
          bottom: 0.15
        }
      },
      timeScale: {
        borderColor: '#1a2436',
        timeVisible: true,
        secondsVisible: false
      }
    });

    chartApiRef.current = chart;
    chart.timeScale().subscribeVisibleTimeRangeChange(updateSignalBadges);

    // Add Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#0BBA74',
      downColor: '#FF4761',
      borderVisible: false,
      wickUpColor: '#0BBA74',
      wickDownColor: '#FF4761'
    });
    candleSeriesRef.current = candleSeries as any;
    markerPluginRef.current = createSeriesMarkers(candleSeries as any, []);
    plottedCandlesRef.current = [];

    const updateLiveArrow = () => {
      const visible = chart.timeScale().getVisibleLogicalRange();
      const lastIndex = plottedCandlesRef.current.length - 1;
      if (!visible || lastIndex < 0) return;
      setShowJumpToLive(visible.to < lastIndex - 2);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateLiveArrow);

    // Hover tooltip tracking
    chart.subscribeCrosshairMove((param) => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        setHoveredCandle(null);
      } else {
        const found = candleLookupRef.current.get(Number(param.time));
        if (found) {
          // Mouse movement within the same bar must not re-render the entire
          // toolbar and chart on every pixel of movement.
          setHoveredCandle((previous) => previous?.time === found.time ? previous : found);
        }
      }
    });

    // Handle container resize
    const handleResize = () => {
      if (chartContainerRef.current && chartApiRef.current) {
        chartApiRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: isFullscreen ? Math.max(300, window.innerHeight - 125) : height
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateSignalBadges);
      if (badgeFrameRef.current !== null) cancelAnimationFrame(badgeFrameRef.current);
      badgeFrameRef.current = null;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateLiveArrow);
      window.removeEventListener('resize', handleResize);
      if (chartApiRef.current) {
        chartApiRef.current.remove();
        chartApiRef.current = null;
        markerPluginRef.current = null;
      }
    };
  }, [height, isFullscreen]);

  // 2. Data update effect — smoothly updates candle data without destroying chart or resetting zoom
  useEffect(() => {
    if (!chartApiRef.current || !candleSeriesRef.current) return;
    if (!candles || candles.length === 0) {
      candleSeriesRef.current.setData([]);
      markerPluginRef.current?.setMarkers([]);
      plottedCandlesRef.current = [];
      candlesRef.current = [];
      candleLookupRef.current.clear();
      setHoveredCandle(null);
      setSignalBadges([]);
      return;
    }

    candlesRef.current = candles;
    candleLookupRef.current = new Map(candles.map((bar) => [bar.time, bar]));

    // Keep small-cap perpetual prices legible instead of displaying 0.00.
    const referencePrice = candles[candles.length - 1].close;
    const precision = referencePrice > 0
      ? Math.max(2, Math.min(8, Math.ceil(-Math.log10(referencePrice)) + 3))
      : 2;
    badgePrecisionRef.current = precision;
    badgeSignalsRef.current = signals;
    candleSeriesRef.current.applyOptions({
      priceFormat: { type: 'price', precision, minMove: 10 ** -precision }
    });

    const previous = plottedCandlesRef.current;
    const sameMarket = prevSymbolRef.current === symbol && prevTfRef.current === timeframeMinutes;
    const visibleTimeRange = sameMarket ? chartApiRef.current.timeScale().getVisibleRange() : null;
    const canUpdateLast = sameMarket && previous.length > 0 &&
      previous[0].time === candles[0].time &&
      candles.length >= previous.length && candles.length <= previous.length + 1 &&
      candles[candles.length - 1].time >= previous[previous.length - 1].time;
    if (canUpdateLast) {
      const c = candles[candles.length - 1];
      candleSeriesRef.current.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close });
    } else {
      const formattedCandles: CandlestickData<Time>[] = candles.map((c) => ({
        time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close
      }));
      candleSeriesRef.current.setData(formattedCandles);
      // When a background 3m/1y download prepends older candles, Lightweight
      // Charts changes logical bar indices. Restore the *time* viewport to
      // avoid the visible chart jumping to another month while the user pans.
      if (visibleTimeRange && previous.length > 0) {
        chartApiRef.current.timeScale().setVisibleRange(visibleTimeRange);
      }
    }
    plottedCandlesRef.current = candles;

    // Indicator overlays
    lineSeriesMapRef.current.forEach((series) => {
      try {
        chartApiRef.current?.removeSeries(series);
      } catch {}
    });
    lineSeriesMapRef.current.clear();

    if (showIndicators && signals && signals.plots) {
      for (const plot of signals.plots) {
        const lineSeries = chartApiRef.current.addSeries(LineSeries, {
          color: plot.color,
          lineWidth: (plot.linewidth || 1) as any,
          title: plot.name,
          priceLineVisible: false,
          lastValueVisible: false
        });

        const plotData: LineData<Time>[] = plot.data
          .filter((d) => d.value !== undefined && !isNaN(d.value))
          .map((d) => ({
            time: d.time as Time,
            value: d.value
          }));

        lineSeries.setData(plotData);
        lineSeriesMapRef.current.set(plot.name, lineSeries);
      }
    }

    // BUY and SELL signal markers
    const markers: SeriesMarker<Time>[] = [];

    // Signal labels are rendered as readable HTML badges instead of tiny canvas text.

    // Selected Trade Entry & Exit markers if inspecting a trade
    if (selectedTrade) {
      markers.push({
        time: selectedTrade.entryTime as Time,
        position: selectedTrade.side === 'BUY' ? 'belowBar' : 'aboveBar',
        color: '#38bdf8',
        shape: 'circle',
        text: `ENTRY ${selectedTrade.side} @ $${selectedTrade.entryPrice}`,
        size: 2
      });

      if (selectedTrade.exitTime && selectedTrade.exitPrice) {
        const sign = Number(selectedTrade.pnlUsdt || 0) >= 0 ? '+' : '';
        markers.push({
          time: selectedTrade.exitTime as Time,
          position: selectedTrade.side === 'BUY' ? 'aboveBar' : 'belowBar',
          color: Number(selectedTrade.pnlUsdt || 0) >= 0 ? '#0BBA74' : '#FF4761',
          shape: 'circle',
          text: `EXIT ${sign}${Number(selectedTrade.pnlUsdt || 0).toFixed(2)} USDT`,
          size: 2
        });
      }
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time));
    markerPluginRef.current?.setMarkers(markers);
    updateSignalBadges();

    // Only auto-fit zoom when symbol or timeframe changes, NOT on every 3s live tick update
    if (prevSymbolRef.current !== symbol || prevTfRef.current !== timeframeMinutes) {
      prevSymbolRef.current = symbol;
      prevTfRef.current = timeframeMinutes;
      chartApiRef.current.timeScale().fitContent();
      setShowJumpToLive(false);
    }
  }, [candles, signals, selectedTrade, showIndicators, symbol, timeframeMinutes]);

  useEffect(() => { setHoveredCandle(null); }, [symbol, timeframeMinutes]);

  const lastCandle = candles[candles.length - 1];
  const activeCandle = hoveredCandle || lastCandle;
  const displayPrecision = lastCandle?.close > 0
    ? Math.max(2, Math.min(8, Math.ceil(-Math.log10(lastCandle.close)) + 3))
    : 6;
  const isUp = activeCandle ? activeCandle.close >= activeCandle.open : true;
  const changePct = activeCandle && activeCandle.open > 0
    ? (((activeCandle.close - activeCandle.open) / activeCandle.open) * 100).toFixed(2)
    : '0.00';

  const chartElement = (
    <div
      ref={chartRootRef}
      className={`relative bg-[#171920] border border-[#1a2436] rounded-xl overflow-hidden shadow-md flex flex-col ${
        isFullscreen ? 'fixed inset-0 z-[100] rounded-none shadow-2xl' : ''
      }`}
    >
      {/* Top Chart Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[#152236] bg-[#171920]">
        {/* Left: Symbol & Price Ticker */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm">
              ₿
            </span>
            {onSymbolChange ? (
              <select
                value={symbol}
                onChange={(e) => onSymbolChange(e.target.value)}
                className="bg-[#171920] border border-[#1b2b44] text-base font-extrabold text-white rounded-lg px-3 py-1 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                {availableSymbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-extrabold text-base text-white tracking-wide">{symbol}</span>
            )}
          </div>

          {activeCandle && (
            <div className="flex flex-wrap items-center gap-3 font-mono">
              <span className={`text-xl sm:text-2xl font-extrabold tabular-nums ${isUp ? 'text-[#0BBA74]' : 'text-[#FF4761]'}`}>
                ${activeCandle.close.toLocaleString(undefined, { minimumFractionDigits: displayPrecision, maximumFractionDigits: displayPrecision })}
              </span>
              <span className={`text-sm sm:text-base px-2 py-0.5 rounded-md font-bold tabular-nums ${isUp ? 'bg-emerald-500/15 text-[#0BBA74]' : 'bg-rose-500/15 text-[#FF4761]'}`}>
                {isUp ? '+' : ''}{changePct}%
              </span>
            </div>
          )}
        </div>

        {/* Center: Timeframe Pills */}
        <div className="flex items-center max-w-full overflow-x-auto bg-[#171920] p-1 rounded-xl border border-[#1a2436]">
          {timeframes.map((tf) => (
            <button
              key={tf.label}
              onClick={() => onTimeframeChange && onTimeframeChange(tf.minutes)}
              className={`shrink-0 px-3 py-1.5 text-sm font-semibold rounded-lg transition ${
                timeframeMinutes === tf.minutes
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Right: Live Ticker Indicator, Overlay toggle, signals badge & Fullscreen */}
        <div className="order-first flex w-full flex-wrap items-center gap-2">
          {loading && <span className="text-xs font-semibold text-blue-400">Loading…</span>}
          {/* Real-time live status pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 font-mono text-xs font-bold shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>{isLive ? 'LIVE' : 'PAUSED'}</span>
          </div>

          {onToggleLive && (
            <button
              onClick={onToggleLive}
              title={isLive ? 'Pause real-time market updates' : 'Resume real-time market updates'}
              className={`px-2 py-1 rounded-lg border text-xs font-mono font-bold transition cursor-pointer ${
                isLive
                  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#171920] border-[#1b2b44] text-slate-400 hover:text-white'
              }`}
            >
              {isLive ? 'Auto (3.5s)' : 'Resume'}
            </button>
          )}

          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh latest live candles immediately"
              className="p-1.5 rounded-lg border border-[#1b2b44] bg-[#171920] hover:bg-[#15233a] text-slate-300 hover:text-white transition cursor-pointer"
            >
              <span className="material-symbols-outlined !text-[16px]">refresh</span>
            </button>
          )}

          {signals && (
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono font-bold">
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/40 text-[#0BBA74]">
                <span className="w-2 h-2 rounded-full bg-[#0BBA74]"></span> BUY ({signals.buySignals.length})
              </span>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/40 border border-rose-800/40 text-[#FF4761]">
                <span className="w-2 h-2 rounded-full bg-[#FF4761]"></span> SELL ({signals.sellSignals.length})
              </span>
            </div>
          )}

          <button
            onClick={() => setShowIndicators(!showIndicators)}
            title={showIndicators ? 'Hide Indicator Lines' : 'Overlay Indicator Lines'}
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
              showIndicators
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                : 'bg-[#171920] border-[#1b2b44] text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="material-symbols-outlined !text-[15px]">
              {showIndicators ? 'visibility' : 'visibility_off'}
            </span>
            <span>{showIndicators ? 'Overlays On' : 'Clean Chart'}</span>
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Chart'}
            className="p-1.5 rounded-lg bg-[#171920] hover:bg-[#15233a] border border-[#1b2b44] text-slate-300 hover:text-white transition cursor-pointer"
          >
            <span className="material-symbols-outlined !text-[18px]">
              {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
            </span>
          </button>
          {onCandleTypeChange && (
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-[#19273c] bg-[#171920] p-1">
              {([['regular', 'Candles'], ['heikin_ashi', 'Heikin Ashi'], ['renko', 'Renko']] as const).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onCandleTypeChange(type)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${candleType === type ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
                >{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="relative flex-1 w-full flex" style={{ height: isFullscreen ? 'calc(100dvh - 125px)' : `${height}px` }}>
        {/* Lightweight Charts Canvas Container */}
        <div ref={chartContainerRef} className="flex-1 w-full h-full" />

        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          {signalBadges.map((badge) => (
            <div
              key={badge.key}
              style={{ left: badge.left, top: badge.top, transform: badge.side === 'SELL' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)' }}
              className={`absolute whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] font-extrabold leading-5 text-white shadow-lg ring-1 ring-white/20 ${badge.side === 'BUY' ? 'bg-[#0BBA74]' : 'bg-[#FF4761]'}`}
            >
              {badge.side === 'BUY' ? 'Buy' : 'Sell'} <span className="font-mono tabular-nums">{badge.price}</span>
            </div>
          ))}
        </div>

        {showJumpToLive && (
          <button
            type="button"
            onClick={() => {
              chartApiRef.current?.timeScale().scrollToRealTime();
              setShowJumpToLive(false);
            }}
            title="Go to latest candle"
            aria-label="Go to latest live candle"
            className="absolute bottom-12 right-14 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-blue-500/60 bg-[#1463FF] text-white shadow-lg hover:bg-blue-500 transition"
          >
            <span className="material-symbols-outlined !text-[23px]">arrow_forward</span>
          </button>
        )}

        {/* Legend Overlay - Minimal when clean, detailed only when overlays enabled */}
        {showIndicators && (
          <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2.5 text-xs bg-[#171920]/90 backdrop-blur px-3 py-1.5 rounded-lg border border-[#172338] text-slate-200 pointer-events-none">
            <span className="text-amber-400 font-bold font-mono">KEYS v6 Indicator</span>
            <span className="text-emerald-400 font-medium">● YPSAR</span>
            <span className="text-orange-400 font-medium">● DPSAR</span>
            <span className="text-purple-400 font-medium">● Upper Channel</span>
            <span className="text-rose-400 font-medium">● Lower Channel</span>
            <span className="text-blue-400 font-medium">✕ Parabolic SAR</span>
          </div>
        )}
      </div>
    </div>
  );
  return isFullscreen ? createPortal(chartElement, document.body) : chartElement;
};
