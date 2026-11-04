import React, { useEffect, useRef, useState } from 'react';
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
}

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
  onRefresh
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const lineSeriesMapRef = useRef<Map<string, ISeriesApi<any>>>(new Map());
  const candlesRef = useRef<OHLCV[]>(candles);
  const prevSymbolRef = useRef<string>(symbol);
  const prevTfRef = useRef<number>(timeframeMinutes);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool, setActiveTool] = useState<string>('pointer');
  const [hoveredCandle, setHoveredCandle] = useState<OHLCV | null>(null);
  const [showIndicators, setShowIndicators] = useState<boolean>(showIndicatorsProp);

  const timeframes = [
    { label: '5m', minutes: 5 },
    { label: '15m', minutes: 15 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '4h', minutes: 240 },
    { label: '1D', minutes: 1440 }
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
      height: isFullscreen ? window.innerHeight - 130 : height,
      layout: {
        background: { color: '#090e17' },
        textColor: '#94a3b8'
      },
      grid: {
        vertLines: { color: '#131c2b' },
        horzLines: { color: '#131c2b' }
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

    // Add Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#0BBA74',
      downColor: '#FF4761',
      borderVisible: false,
      wickUpColor: '#0BBA74',
      wickDownColor: '#FF4761'
    });
    candleSeriesRef.current = candleSeries as any;

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
        const found = candlesRef.current.find((c) => c.time === Number(param.time));
        if (found) {
          setHoveredCandle(found);
        }
      }
    });

    // Handle container resize
    const handleResize = () => {
      if (chartContainerRef.current && chartApiRef.current) {
        chartApiRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: isFullscreen ? window.innerHeight - 130 : height
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartApiRef.current) {
        chartApiRef.current.remove();
        chartApiRef.current = null;
      }
    };
  }, [height, isFullscreen]);

  // 2. Data update effect — smoothly updates candle data without destroying chart or resetting zoom
  useEffect(() => {
    if (!chartApiRef.current || !candleSeriesRef.current || !candles || candles.length === 0) return;

    candlesRef.current = candles;

    const formattedCandles: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
    candleSeriesRef.current.setData(formattedCandles);

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

    if (signals) {
      for (const buy of signals.buySignals) {
        markers.push({
          time: buy.time as Time,
          position: 'belowBar',
          color: '#0BBA74',
          shape: 'arrowUp',
          text: 'BUY',
          size: 1
        });
      }

      for (const sell of signals.sellSignals) {
        markers.push({
          time: sell.time as Time,
          position: 'aboveBar',
          color: '#FF4761',
          shape: 'arrowDown',
          text: 'SELL',
          size: 1
        });
      }
    }

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
    if (markers.length > 0) {
      createSeriesMarkers(candleSeriesRef.current, markers);
    }

    // Only auto-fit zoom when symbol or timeframe changes, NOT on every 3s live tick update
    if (prevSymbolRef.current !== symbol || prevTfRef.current !== timeframeMinutes) {
      prevSymbolRef.current = symbol;
      prevTfRef.current = timeframeMinutes;
      chartApiRef.current.timeScale().fitContent();
    }
  }, [candles, signals, selectedTrade, showIndicators, symbol, timeframeMinutes]);

  const lastCandle = candles[candles.length - 1];
  const activeCandle = hoveredCandle || lastCandle;
  const isUp = activeCandle ? activeCandle.close >= activeCandle.open : true;
  const changePct = activeCandle && activeCandle.open > 0
    ? (((activeCandle.close - activeCandle.open) / activeCandle.open) * 100).toFixed(2)
    : '0.00';

  return (
    <div
      className={`relative bg-[#171920] border border-[#1a2436] rounded-xl overflow-hidden shadow-md flex flex-col ${
        isFullscreen ? 'fixed inset-4 z-50 shadow-2xl' : ''
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
                ${activeCandle.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className={`text-sm sm:text-base px-2 py-0.5 rounded-md font-bold tabular-nums ${isUp ? 'bg-emerald-500/15 text-[#0BBA74]' : 'bg-rose-500/15 text-[#FF4761]'}`}>
                {isUp ? '+' : ''}{changePct}%
              </span>
              <span className="hidden md:inline text-slate-400 text-sm tabular-nums space-x-2">
                <span>O: <strong className="text-slate-100">{activeCandle.open}</strong></span>
                <span>H: <strong className="text-slate-100">{activeCandle.high}</strong></span>
                <span>L: <strong className="text-slate-100">{activeCandle.low}</strong></span>
                <span>V: <strong className="text-slate-100">{activeCandle.volume.toFixed(1)}</strong></span>
              </span>
            </div>
          )}
        </div>

        {/* Center: Timeframe Pills */}
        <div className="flex items-center bg-[#171920] p-1 rounded-xl border border-[#1a2436]">
          {timeframes.map((tf) => (
            <button
              key={tf.label}
              onClick={() => onTimeframeChange && onTimeframeChange(tf.minutes)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition ${
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
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="relative flex-1 w-full flex" style={{ height: isFullscreen ? 'calc(100vh - 130px)' : `${height}px` }}>
        {/* Left Drawing Tools Sidebar Toolbar from Stitch */}
        <div className="w-10 border-r border-[#152236] bg-[#171920] flex flex-col items-center py-2 space-y-2 shrink-0 z-10 text-slate-400">
          <button
            onClick={() => setActiveTool('pointer')}
            className={`p-1.5 rounded-lg transition ${activeTool === 'pointer' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800 text-slate-400'}`}
            title="Crosshair"
          >
            <span className="material-symbols-outlined !text-[18px]">point_scan</span>
          </button>
          <button
            onClick={() => setActiveTool('trendline')}
            className={`p-1.5 rounded-lg transition ${activeTool === 'trendline' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800 text-slate-400'}`}
            title="Trendline"
          >
            <span className="material-symbols-outlined !text-[18px]">show_chart</span>
          </button>
          <button
            onClick={() => setActiveTool('channel')}
            className={`p-1.5 rounded-lg transition ${activeTool === 'channel' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800 text-slate-400'}`}
            title="Channels"
          >
            <span className="material-symbols-outlined !text-[18px]">crop_square</span>
          </button>
          <button
            onClick={() => setActiveTool('text')}
            className={`p-1.5 rounded-lg transition ${activeTool === 'text' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800 text-slate-400'}`}
            title="Text Note"
          >
            <span className="material-symbols-outlined !text-[18px]">title</span>
          </button>
          <div className="w-5 h-[1px] bg-[#1a2436] my-1"></div>
          <button
            onClick={() => setActiveTool('clear')}
            className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition"
            title="Clear"
          >
            <span className="material-symbols-outlined !text-[18px]">delete</span>
          </button>
        </div>

        {/* Lightweight Charts Canvas Container */}
        <div ref={chartContainerRef} className="flex-1 w-full h-full" />

        {/* Legend Overlay - Minimal when clean, detailed only when overlays enabled */}
        {showIndicators && (
          <div className="absolute top-3 left-14 z-20 flex flex-wrap items-center gap-2.5 text-xs bg-[#171920]/90 backdrop-blur px-3 py-1.5 rounded-lg border border-[#172338] text-slate-200 pointer-events-none">
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
};
