/**
 * KEYS Strategy Lab - Type Definitions
 */

export type ExchangeId = 'bybit' | 'binance' | 'okx' | 'bitget' | 'kucoin' | 'gateio' | 'mexc';

export type AppPage = 'chart' | 'results' | 'positions' | 'symbols';

export interface ExchangeInfo {
  id: ExchangeId;
  name: string;
  logo: string;
  defaultFeeMaker: number; // e.g. 0.0002 (0.02%)
  defaultFeeTaker: number; // e.g. 0.00055 (0.055%)
  defaultFundingRate: number; // 0.0001 per 8h
  supportsMaxLeverage: boolean;
}

export interface SymbolMeta {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: ExchangeId;
  maxLeverage: number;
  minNotional: number;
  pricePrecision: number;
  quantityPrecision: number;
  category: 'LAYER1' | 'LAYER2' | 'DeFi' | 'AI' | 'GameFi' | 'Meme' | 'Payments' | 'NFT' | 'Other';
  lastPrice: number;
  change24h: number;
  volume24h: number;
  fundingRate?: number | null; // percentage, real exchange ticker
}

export interface SavedSymbolGroup {
  id: string;
  name: string;
  exchange: ExchangeId;
  symbols: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OHLCV {
  time: number; // unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorParam {
  id: string;
  name: string;
  title: string;
  type: 'int' | 'float' | 'bool' | 'string';
  value: number | boolean | string;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  group?: string;
  tooltip?: string;
  options?: string[];
}

export interface IndicatorSignals {
  buySignals: { time: number; price: number; reason?: string }[];
  sellSignals: { time: number; price: number; reason?: string }[];
  plots: {
    name: string;
    color: string;
    linewidth?: number;
    style?: 'line' | 'cross' | 'circles';
    data: { time: number; value: number }[];
  }[];
}

export interface PnLRuleRow {
  fromPct: number;
  toPct: number;
  dropPct: number;
}

export interface PortfolioConfig {
  exchange: ExchangeId;
  savedGroupId: string;
  initialCapital: number; // USDT, default 300
  positionSizeNotional: number; // USDT notional, default 10
  useMaxLeverage: boolean; // default true
  manualLeverage: number; // default 10
  marginMode: 'cross' | 'isolated'; // default cross
  maxOpenPositions: number; // default 100
  cycleFromDay: number; // default 1
  cycleToDay: number; // default 7
  backtestTimeframe: number; // minutes, default 5
  testPeriodDays?: number; // historical test duration, 30–365 days
  maxDrawdownCutoff: number; // % e.g. 15
  slippageTolerance: number; // % e.g. 0.05
  feeTakerPct: number; // % e.g. 0.05
  feeMakerPct: number; // % e.g. 0.02
  fundingRate8hPct: number; // % e.g. 0.01
}

export interface PnLConfig {
  rules: PnLRuleRow[];
  fixedFloorEnabled: boolean;
  fixedFloorTriggerPct: number;
  fixedFloorLockPct: number;
}

export type TradeSide = 'BUY' | 'SELL';
export type TradeStatus = 'OPEN' | 'CLOSED';
export type ExitReason =
  | 'PNL_DROP_FLOOR'
  | 'CYCLE_EXPIRY'
  | 'MAX_DRAWDOWN'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'OPPOSITE_SIGNAL'
  | 'BACKTEST_END';

export interface PositionTrade {
  id: string;
  symbol: string;
  side: TradeSide;
  entryTime: number; // seconds
  exitTime?: number; // seconds
  entryPrice: number;
  exitPrice?: number;
  notional: number; // USDT
  leverage: number;
  margin: number; // USDT
  pnlUsdt: number;
  pnlPct: number;
  feePaid: number;
  fundingPaid: number;
  status: TradeStatus;
  exitReason?: ExitReason;
  cycleIndex: number;
  adxAtEntry?: number;
  rsiAtEntry?: number;
  entrySignalTime?: number;
  entrySignalReason?: string;
}

export interface CycleRecord {
  cycleIndex: number;
  startTime: number;
  endTime: number;
  startEquity: number;
  endEquity: number;
  peakProfitPct: number;
  exitFloorPct: number;
  activeRule?: PnLRuleRow;
  exitReason: ExitReason;
  tradesCount: number;
  realizedPnl: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
  balance: number;
  unrealizedPnl: number;
  peakEquity: number;
  drawdownPct: number;
  openPositionsCount: number;
  cycleIndex: number;
  activeFloorPct?: number;
}

export interface BacktestRun {
  id: string;
  name: string;
  createdAt: string;
  exchange: ExchangeId;
  symbolGroupId: string;
  symbolGroupName: string;
  symbolsCount: number;
  timeframeMinutes: number;
  strategyName: string;
  indicatorId?: string;
  testPeriodDays: number;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalBalance: number;
  netPnl: number;
  /** Account cash including realized results, entry fees and funding. */
  cashBalance?: number;
  /** Mark-to-market PnL of positions still OPEN at the final candle. */
  unrealizedPnl?: number;
  /** Number of positions still OPEN at the end of the historical window. */
  openPositionsCount?: number;
  roiPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  completedCycles: number;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'FAILED';
  durationSec: number;
  portfolioConfig: PortfolioConfig;
  pnlConfig: PnLConfig;
  indicatorParams: Record<string, number | boolean | string>;
  equityCurve: EquityPoint[];
  trades: PositionTrade[];
  cycles: CycleRecord[];
  logs: string[];
  error?: string;
  isDemo?: boolean;
}

export interface SavedIndicator {
  id: string;
  name: string;
  version: 'v5' | 'v6';
  type: 'Indicator' | 'Strategy';
  lastUpdated: string;
  validationStatus: 'Validated' | 'Backtest Ready' | 'Saved' | 'Unsupported';
  chartStatus: 'Chart Ready' | 'Active on Chart' | 'Not on Chart' | 'Disabled';
  code: string;
  params: IndicatorParam[];
}
