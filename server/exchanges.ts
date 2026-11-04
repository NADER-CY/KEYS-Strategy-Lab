/**
 * Real Multi-Exchange Historical Data Pipeline for USDT-Margined Perpetual Futures
 * Supported Exchanges: Bybit, Binance, OKX, Bitget, KuCoin, Gate.io, MEXC
 * Features: Public APIs only, pagination, incremental caching, deduplication,
 * UTC alignment, exponential backoff, custom timeframe aggregation, no synthetic fallbacks.
 */
import fs from 'fs';
import path from 'path';
import { ExchangeId, ExchangeInfo, SymbolMeta, OHLCV } from '../src/types';
import { toBybitContractSymbol } from '../src/engine/bybitContracts';
export { BYBIT_CONTRACT_ALIASES, toBybitContractSymbol } from '../src/engine/bybitContracts';

export const SUPPORTED_EXCHANGES: ExchangeInfo[] = [
  {
    id: 'bybit',
    name: 'Bybit',
    logo: 'https://assets.coingecko.com/markets/images/698/small/bybit_logo.png',
    defaultFeeMaker: 0.0002, // 0.02%
    defaultFeeTaker: 0.00055, // 0.055%
    defaultFundingRate: 0.0001,
    supportsMaxLeverage: true
  },
  {
    id: 'binance',
    name: 'Binance',
    logo: 'https://assets.coingecko.com/markets/images/52/small/binance.jpg',
    defaultFeeMaker: 0.0002,
    defaultFeeTaker: 0.0004,
    defaultFundingRate: 0.0001,
    supportsMaxLeverage: true
  },
  {
    id: 'okx',
    name: 'OKX',
    logo: 'https://assets.coingecko.com/markets/images/96/small/okx.png',
    defaultFeeMaker: 0.0002,
    defaultFeeTaker: 0.0005,
    defaultFundingRate: 0.0001,
    supportsMaxLeverage: true
  },
  {
    id: 'bitget',
    name: 'Bitget',
    logo: 'https://assets.coingecko.com/markets/images/440/small/bitget.png',
    defaultFeeMaker: 0.0002,
    defaultFeeTaker: 0.0006,
    defaultFundingRate: 0.0001,
    supportsMaxLeverage: true
  },
  {
    id: 'gateio',
    name: 'Gate.io',
    logo: 'https://assets.coingecko.com/markets/images/60/small/gateio.png',
    defaultFeeMaker: 0.00015,
    defaultFeeTaker: 0.0005,
    defaultFundingRate: 0.0001,
    supportsMaxLeverage: true
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    logo: 'https://assets.coingecko.com/markets/images/61/small/kucoin.png',
    defaultFeeMaker: 0.0002,
    defaultFeeTaker: 0.0006,
    defaultFundingRate: 0.0001,
    supportsMaxLeverage: true
  },
  {
    id: 'mexc',
    name: 'MEXC',
    logo: 'https://assets.coingecko.com/markets/images/409/small/mexc.png',
    defaultFeeMaker: 0.0000,
    defaultFeeTaker: 0.0002,
    defaultFundingRate: 0.0001,
    supportsMaxLeverage: true
  }
];

// Top 50 USDT Perpetual Symbols Metadata
const DEFAULT_PERPETUAL_SYMBOLS: Omit<SymbolMeta, 'exchange'>[] = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', maxLeverage: 100, minNotional: 5, pricePrecision: 1, quantityPrecision: 3, category: 'LAYER1', lastPrice: 76880.50, change24h: 2.31, volume24h: 12450000000 },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', maxLeverage: 100, minNotional: 5, pricePrecision: 2, quantityPrecision: 2, category: 'LAYER1', lastPrice: 3472.18, change24h: 1.87, volume24h: 6210000000 },
  { symbol: 'SOLUSDT', baseAsset: 'SOL', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 2, quantityPrecision: 1, category: 'LAYER1', lastPrice: 168.42, change24h: 3.96, volume24h: 2980000000 },
  { symbol: 'BNBUSDT', baseAsset: 'BNB', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 2, quantityPrecision: 2, category: 'LAYER1', lastPrice: 612.60, change24h: 1.24, volume24h: 1870000000 },
  { symbol: 'XRPUSDT', baseAsset: 'XRP', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'Payments', lastPrice: 0.6248, change24h: 1.69, volume24h: 1560000000 },
  { symbol: 'ADAUSDT', baseAsset: 'ADA', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER1', lastPrice: 0.4129, change24h: 2.17, volume24h: 785360000 },
  { symbol: 'AVAXUSDT', baseAsset: 'AVAX', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 2, quantityPrecision: 1, category: 'LAYER1', lastPrice: 34.81, change24h: 3.08, volume24h: 742110000 },
  { symbol: 'DOGEUSDT', baseAsset: 'DOGE', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 5, quantityPrecision: 0, category: 'Meme', lastPrice: 0.1428, change24h: 2.96, volume24h: 2110000000 },
  { symbol: 'TRXUSDT', baseAsset: 'TRX', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 5, quantityPrecision: 0, category: 'LAYER1', lastPrice: 0.1365, change24h: 0.74, volume24h: 403270000 },
  { symbol: 'DOTUSDT', baseAsset: 'DOT', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'LAYER1', lastPrice: 7.362, change24h: 1.49, volume24h: 286480000 },
  { symbol: 'LINKUSDT', baseAsset: 'LINK', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'DeFi', lastPrice: 18.47, change24h: 2.62, volume24h: 561230000 },
  { symbol: 'POLUSDT', baseAsset: 'POL', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER2', lastPrice: 0.3892, change24h: 2.11, volume24h: 370880000 },
  { symbol: 'ARBUSDT', baseAsset: 'ARB', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER2', lastPrice: 0.9821, change24h: 3.44, volume24h: 321760000 },
  { symbol: 'OPUSDT', baseAsset: 'OP', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'LAYER2', lastPrice: 1.684, change24h: -0.37, volume24h: 197230000 },
  { symbol: 'INJUSDT', baseAsset: 'INJ', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'DeFi', lastPrice: 28.15, change24h: 4.12, volume24h: 389410000 },
  { symbol: 'APTUSDT', baseAsset: 'APT', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'LAYER1', lastPrice: 9.462, change24h: 2.78, volume24h: 268550000 },
  { symbol: 'SUIUSDT', baseAsset: 'SUI', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER1', lastPrice: 1.982, change24h: 3.19, volume24h: 311070000 },
  { symbol: 'NEARUSDT', baseAsset: 'NEAR', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'AI', lastPrice: 5.602, change24h: 1.63, volume24h: 229140000 },
  { symbol: 'FETUSDT', baseAsset: 'FET', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'AI', lastPrice: 1.269, change24h: 5.07, volume24h: 184620000 },
  { symbol: 'RENDERUSDT', baseAsset: 'RENDER', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'AI', lastPrice: 7.221, change24h: 3.02, volume24h: 176030000 },
  { symbol: 'PEPEUSDT', baseAsset: 'PEPE', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 8, quantityPrecision: 0, category: 'Meme', lastPrice: 0.00000945, change24h: 6.84, volume24h: 1450000000 },
  { symbol: 'SHIBUSDT', baseAsset: 'SHIB', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 8, quantityPrecision: 0, category: 'Meme', lastPrice: 0.00001842, change24h: 1.45, volume24h: 890000000 },
  { symbol: 'WIFUSDT', baseAsset: 'WIF', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'Meme', lastPrice: 2.348, change24h: 4.88, volume24h: 680000000 },
  { symbol: 'BONKUSDT', baseAsset: 'BONK', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 8, quantityPrecision: 0, category: 'Meme', lastPrice: 0.00002130, change24h: 3.12, volume24h: 430000000 },
  { symbol: 'UNIUSDT', baseAsset: 'UNI', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'DeFi', lastPrice: 8.452, change24h: 1.89, volume24h: 210000000 },
  { symbol: 'AAVEUSDT', baseAsset: 'AAVE', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 2, quantityPrecision: 2, category: 'DeFi', lastPrice: 154.20, change24h: 3.45, volume24h: 340000000 },
  { symbol: 'MKRUSDT', baseAsset: 'MKR', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 1, quantityPrecision: 3, category: 'DeFi', lastPrice: 1420.50, change24h: -1.20, volume24h: 98000000 },
  { symbol: 'PENDLEUSDT', baseAsset: 'PENDLE', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'DeFi', lastPrice: 4.821, change24h: 5.23, volume24h: 185000000 },
  { symbol: 'ENAUSDT', baseAsset: 'ENA', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'DeFi', lastPrice: 0.3845, change24h: 2.91, volume24h: 165000000 },
  { symbol: 'GALAUSDT', baseAsset: 'GALA', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 5, quantityPrecision: 0, category: 'GameFi', lastPrice: 0.02451, change24h: 1.15, volume24h: 110000000 },
  { symbol: 'AXSUSDT', baseAsset: 'AXS', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'GameFi', lastPrice: 5.120, change24h: 0.85, volume24h: 87000000 },
  { symbol: 'SANDUSDT', baseAsset: 'SAND', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'GameFi', lastPrice: 0.2842, change24h: 1.62, volume24h: 94000000 },
  { symbol: 'MANAUSDT', baseAsset: 'MANA', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'GameFi', lastPrice: 0.3125, change24h: 1.34, volume24h: 82000000 },
  { symbol: 'TAOUSDT', baseAsset: 'TAO', quoteAsset: 'USDT', maxLeverage: 25, minNotional: 5, pricePrecision: 2, quantityPrecision: 2, category: 'AI', lastPrice: 520.40, change24h: 4.12, volume24h: 230000000 },
  { symbol: 'WLDUSDT', baseAsset: 'WLD', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'AI', lastPrice: 1.984, change24h: 2.45, volume24h: 310000000 },
  { symbol: 'ICPUSDT', baseAsset: 'ICP', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'LAYER1', lastPrice: 8.240, change24h: 0.95, volume24h: 145000000 },
  { symbol: 'SEIUSDT', baseAsset: 'SEI', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER1', lastPrice: 0.4120, change24h: 3.20, volume24h: 195000000 },
  { symbol: 'TIAUSDT', baseAsset: 'TIA', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER1', lastPrice: 5.340, change24h: 2.10, volume24h: 175000000 },
  { symbol: 'KASUSDT', baseAsset: 'KAS', quoteAsset: 'USDT', maxLeverage: 25, minNotional: 5, pricePrecision: 5, quantityPrecision: 0, category: 'LAYER1', lastPrice: 0.1340, change24h: 1.78, volume24h: 125000000 },
  { symbol: 'FTMUSDT', baseAsset: 'FTM', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER1', lastPrice: 0.6920, change24h: 4.25, volume24h: 285000000 },
  { symbol: 'STXUSDT', baseAsset: 'STX', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER2', lastPrice: 1.845, change24h: 2.65, volume24h: 140000000 },
  { symbol: 'IMXUSDT', baseAsset: 'IMX', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'LAYER2', lastPrice: 1.342, change24h: 1.95, volume24h: 115000000 },
  { symbol: 'LDOUSDT', baseAsset: 'LDO', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'DeFi', lastPrice: 1.240, change24h: 0.65, volume24h: 95000000 },
  { symbol: 'CRVUSDT', baseAsset: 'CRV', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'DeFi', lastPrice: 0.285, change24h: 1.45, volume24h: 75000000 },
  { symbol: 'RUNEUSDT', baseAsset: 'RUNE', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 3, quantityPrecision: 1, category: 'DeFi', lastPrice: 5.120, change24h: 2.85, volume24h: 165000000 },
  { symbol: 'FLOKIUSDT', baseAsset: 'FLOKI', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 8, quantityPrecision: 0, category: 'Meme', lastPrice: 0.0001425, change24h: 3.75, volume24h: 280000000 },
  { symbol: 'BOMEUSDT', baseAsset: 'BOME', quoteAsset: 'USDT', maxLeverage: 50, minNotional: 5, pricePrecision: 6, quantityPrecision: 0, category: 'Meme', lastPrice: 0.00892, change24h: 2.45, volume24h: 195000000 },
  { symbol: 'POPCATUSDT', baseAsset: 'POPCAT', quoteAsset: 'USDT', maxLeverage: 25, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'Meme', lastPrice: 1.542, change24h: 6.25, volume24h: 310000000 },
  { symbol: 'NEIROUSDT', baseAsset: 'NEIRO', quoteAsset: 'USDT', maxLeverage: 25, minNotional: 5, pricePrecision: 6, quantityPrecision: 0, category: 'Meme', lastPrice: 0.00185, change24h: 8.45, volume24h: 420000000 },
  { symbol: 'BLURUSDT', baseAsset: 'BLUR', quoteAsset: 'USDT', maxLeverage: 25, minNotional: 5, pricePrecision: 4, quantityPrecision: 0, category: 'NFT', lastPrice: 0.2450, change24h: 1.15, volume24h: 65000000 }
];

/** Atomic JSON write: a crash mid-write can never leave a truncated file. */
function writeJsonAtomic(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
  fs.renameSync(temporary, file);
}

export interface FundingEvent { time: number; rate: number }

export class ExchangeDataService {
  private cacheDir: string;
  private liveRefreshAt = new Map<string, number>();
  /**
   * Parsed base-candle caches. A year of 5m candles is ~14 MB of JSON; parsing
   * and re-serialising it on every live poll / history page blocked the event
   * loop for ~150 ms per request. Bounded by total candle count.
   */
  private memoryCandles = new Map<string, OHLCV[]>();
  private readonly memoryCandleLimit = 900_000;
  private diskWrittenAt = new Map<string, number>();
  private pendingDiskWrites = new Map<string, ReturnType<typeof setTimeout>>();

  private readCandleCache(cacheFile: string): OHLCV[] {
    const memory = this.memoryCandles.get(cacheFile);
    if (memory) {
      // Refresh LRU position.
      this.memoryCandles.delete(cacheFile);
      this.memoryCandles.set(cacheFile, memory);
      return memory;
    }
    let parsed: OHLCV[] = [];
    try {
      if (fs.existsSync(cacheFile)) {
        const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(raw)) parsed = raw;
      }
    } catch {
      parsed = []; // A corrupted cache must not prevent a real exchange fetch.
    }
    if (parsed.length) this.rememberCandles(cacheFile, parsed);
    return parsed;
  }

  private rememberCandles(cacheFile: string, candles: OHLCV[]): void {
    this.memoryCandles.delete(cacheFile);
    this.memoryCandles.set(cacheFile, candles);
    let total = 0;
    for (const value of this.memoryCandles.values()) total += value.length;
    for (const key of this.memoryCandles.keys()) {
      if (total <= this.memoryCandleLimit || this.memoryCandles.size <= 1) break;
      if (key === cacheFile) continue;
      total -= this.memoryCandles.get(key)!.length;
      this.memoryCandles.delete(key);
    }
  }

  /** Update memory immediately; persist to disk at most every 30 s per file. */
  private writeCandleCache(cacheFile: string, candles: OHLCV[], urgent = true): void {
    this.rememberCandles(cacheFile, candles);
    const persist = () => {
      this.pendingDiskWrites.delete(cacheFile);
      this.diskWrittenAt.set(cacheFile, Date.now());
      try {
        writeJsonAtomic(cacheFile, this.memoryCandles.get(cacheFile) || candles);
      } catch (err) {
        console.warn(`Failed to write OHLCV cache ${path.basename(cacheFile)}:`, err);
      }
    };
    if (urgent) {
      const pending = this.pendingDiskWrites.get(cacheFile);
      if (pending) clearTimeout(pending);
      persist();
      return;
    }
    if (this.pendingDiskWrites.has(cacheFile)) return;
    const wait = Math.max(0, 30_000 - (Date.now() - (this.diskWrittenAt.get(cacheFile) || 0)));
    const timer = setTimeout(persist, wait);
    timer.unref?.();
    this.pendingDiskWrites.set(cacheFile, timer);
  }

  /**
   * Actual historical Bybit funding settlements for [fromSec, toSec].
   * Throws instead of returning a silently truncated history.
   */
  async getBybitFundingHistory(symbol: string, fromSec: number, toSec: number): Promise<FundingEvent[]> {
    const contract = toBybitContractSymbol(symbol);
    const fundingDir = path.join(this.cacheDir, 'funding');
    fs.mkdirSync(fundingDir, { recursive: true });
    const cacheFile = path.join(fundingDir, `bybit_${contract}.json`);
    let cached: { from: number; to: number; rates: FundingEvent[] } | null = null;
    try {
      if (fs.existsSync(cacheFile)) {
        const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (parsed && Array.isArray(parsed.rates)) cached = parsed;
      }
    } catch { /* fetch again */ }
    if (cached && cached.from <= fromSec && cached.to >= toSec) {
      return cached.rates.filter((r) => r.time >= fromSec && r.time <= toSec);
    }

    const found = new Map<number, number>();
    let endMs = toSec * 1000;
    let reachedStart = false;
    // 1h-funding contracts settle 8,760 times a year: 200 pages x 200 rows
    // covers >4 years. The old 30-page cap silently dropped the oldest months.
    for (let page = 0; page < 200; page++) {
      const params = new URLSearchParams({ category: 'linear', symbol: contract, endTime: String(endMs), limit: '200' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let data: any;
      try {
        const response = await fetch(`https://api.bybit.com/v5/market/funding/history?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      } finally { clearTimeout(timeout); }
      if (data.retCode !== 0) throw new Error(`Bybit funding history for ${contract}: ${data.retMsg}`);
      const pageRates = data.result?.list || [];
      if (!pageRates.length) { reachedStart = true; break; }
      let oldest = Infinity;
      for (const item of pageRates) {
        const time = Math.floor(Number(item.fundingRateTimestamp) / 1000);
        const rate = Number(item.fundingRate);
        if (Number.isFinite(time) && Number.isFinite(rate) && time >= fromSec && time <= toSec) found.set(time, rate);
        if (Number.isFinite(time)) oldest = Math.min(oldest, time);
      }
      if (!Number.isFinite(oldest) || oldest <= fromSec || pageRates.length < 200) { reachedStart = true; break; }
      endMs = oldest * 1000 - 1;
    }
    if (!reachedStart) {
      throw new Error(`Bybit funding history for ${contract} is incomplete for the requested window; refusing to under-charge funding.`);
    }
    const rates = [...found.entries()].map(([time, rate]) => ({ time, rate })).sort((a, b) => a.time - b.time);
    if (!rates.length) throw new Error(`No real Bybit funding history available for ${contract}`);
    try { writeJsonAtomic(cacheFile, { from: fromSec, to: toSec, rates }); } catch { /* best effort */ }
    return rates;
  }

  /**
   * Contract limits from the exchange's live instrument list. Returns
   * maxLeverage 0 when the exchange API does not publish a limit.
   */
  async getContractMeta(exchangeId: ExchangeId, symbol: string): Promise<SymbolMeta | undefined> {
    const live = await this.getLiveSymbols(exchangeId);
    const wanted = symbol.toUpperCase();
    const alias = exchangeId === 'bybit' ? toBybitContractSymbol(wanted) : wanted;
    return live.find((s) => s.symbol === wanted) || live.find((s) => s.symbol === alias);
  }

  constructor() {
    this.cacheDir = path.resolve(process.cwd(), '.cache', 'ohlcv');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  getExchange(exchangeId: ExchangeId): ExchangeInfo {
    return SUPPORTED_EXCHANGES.find((e) => e.id === exchangeId) || SUPPORTED_EXCHANGES[0];
  }


  // Live USDT-settled perpetual contracts from Bybit V5; never use sample data for Bybit.
  private bybitUniverseCache: { until: number; symbols: SymbolMeta[] } | null = null;
  private bybitUniversePending: Promise<SymbolMeta[]> | null = null;
  private bybitReturnCache = new Map<string, { until: number; values: Record<string, number | null> }>();

  private async bybitPublic(endpoint: string, params: URLSearchParams): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 14000);
    try {
      const response = await fetch(`https://api.bybit.com/v5/market/${endpoint}?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Bybit HTTP ${response.status}`);
      const payload: any = await response.json();
      if (payload.retCode !== 0) throw new Error(`Bybit: ${payload.retMsg || payload.retCode}`);
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getBybitSymbols(): Promise<SymbolMeta[]> {
    if (this.bybitUniverseCache && this.bybitUniverseCache.until > Date.now()) {
      return this.bybitUniverseCache.symbols;
    }
    if (this.bybitUniversePending) return this.bybitUniversePending;
    this.bybitUniversePending = this.loadBybitSymbols();
    try {
      const symbols = await this.bybitUniversePending;
      this.bybitUniverseCache = { until: Date.now() + 300000, symbols };
      return symbols;
    } catch (error) {
      if (this.bybitUniverseCache) return this.bybitUniverseCache.symbols;
      throw error;
    } finally {
      this.bybitUniversePending = null;
    }
  }

  private async loadBybitSymbols(): Promise<SymbolMeta[]> {
    const instruments: any[] = [];
    let cursor = '';
    for (let page = 0; page < 15; page++) {
      const params = new URLSearchParams({ category: 'linear', status: 'Trading', limit: '1000' });
      if (cursor) params.set('cursor', cursor);
      const result = await this.bybitPublic('instruments-info', params);
      if (!Array.isArray(result.list)) throw new Error('Invalid Bybit instruments response');
      instruments.push(...result.list);
      const next = result.nextPageCursor || '';
      if (!next || next === cursor) break;
      cursor = next;
    }
    const tickersResult = await this.bybitPublic('tickers', new URLSearchParams({ category: 'linear' }));
    const tickers = new Map<string, any>((tickersResult.list || []).map((t: any) => [String(t.symbol), t]));
    const unique = new Map<string, SymbolMeta>();
    for (const instrument of instruments) {
      // Both quote and settlement must be USDT; exclude USDC and dated contracts.
      if (instrument.quoteCoin !== 'USDT' || instrument.settleCoin !== 'USDT' ||
          instrument.status !== 'Trading' || instrument.contractType !== 'LinearPerpetual' ||
          !String(instrument.symbol).endsWith('USDT')) continue;
      const ticker = tickers.get(instrument.symbol);
      const baseAsset = String(instrument.baseCoin || instrument.symbol.slice(0, -4));
      const tickSize = Number(instrument.priceFilter?.tickSize || 0.01);
      const qtyStep = Number(instrument.lotSizeFilter?.qtyStep || 1);
      const decimals = (n: number) => {
        const text = String(n);
        return text.includes('.') ? text.split('.')[1].length : 0;
      };
      unique.set(instrument.symbol, {
        symbol: instrument.symbol,
        baseAsset,
        quoteAsset: 'USDT',
        exchange: 'bybit',
        maxLeverage: Number(instrument.leverageFilter?.maxLeverage) || 0,
        minNotional: Number(instrument.lotSizeFilter?.minNotionalValue) || 0,
        pricePrecision: decimals(tickSize),
        quantityPrecision: decimals(qtyStep),
        category: DEFAULT_PERPETUAL_SYMBOLS.find((s) => s.symbol === instrument.symbol)?.category || 'Other',
        lastPrice: Number(ticker?.lastPrice) || 0,
        change24h: ticker ? Number(ticker.price24hPcnt) * 100 : NaN,
        volume24h: Number(ticker?.turnover24h) || 0,
        fundingRate: ticker ? Number(ticker.fundingRate) * 100 : null
      } as SymbolMeta);
    }
    if (!unique.size) throw new Error('Bybit returned no active USDT perpetual contracts');
    return [...unique.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  // Compute changes from *actual historical close prices*, not simulated 24h percentages.
  // Intraday comparisons use 1h bars; longer comparisons use daily bars.
  async getBybitTimeframeChanges(symbol: string): Promise<Record<string, number | null>> {
    if (!/^[A-Z0-9]{2,35}USDT$/.test(symbol)) throw new Error('Invalid USDT symbol');
    const cached = this.bybitReturnCache.get(symbol);
    if (cached && cached.until > Date.now()) return cached.values;
    const [hourly, daily] = await Promise.all([
      this.bybitPublic('kline', new URLSearchParams({ category: 'linear', symbol, interval: '60', limit: '80' })),
      this.bybitPublic('kline', new URLSearchParams({ category: 'linear', symbol, interval: 'D', limit: '100' }))
    ]);
    const h: any[] = hourly.list || [];
    const d: any[] = daily.list || [];
    const currentPrice = Number(h[0]?.[4]);
    const percent = (rows: any[], hours: number) => {
      if (!Number.isFinite(currentPrice) || currentPrice <= 0 || rows.length <= hours) return null;
      const old = Number(rows[hours]?.[4]);
      return Number.isFinite(old) && old > 0 ? (currentPrice / old - 1) * 100 : null;
    };
    const values: Record<string, number | null> = {
      '1H': percent(h, 1), '2H': percent(h, 2), '4H': percent(h, 4),
      '12H': percent(h, 12), '24H': percent(h, 24), '48H': percent(h, 48),
      '72H': percent(h, 72), '1W': percent(d, 7), '1M': percent(d, 30), '3M': percent(d, 90)
    };
    this.bybitReturnCache.set(symbol, { until: Date.now() + 600000, values });
    return values;
  }


  // Exchange-specific, active USDT-margined perpetual universes. Never substitute demo symbols.
  private otherUniverseCache = new Map<ExchangeId, { until: number; symbols: SymbolMeta[] }>();
  private otherUniversePending = new Map<ExchangeId, Promise<SymbolMeta[]>>();

  private async getJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).host}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async getLiveSymbols(exchangeId: ExchangeId): Promise<SymbolMeta[]> {
    if (exchangeId === 'bybit') return this.getBybitSymbols();
    const cached = this.otherUniverseCache.get(exchangeId);
    if (cached && cached.until > Date.now()) return cached.symbols;
    const pending = this.otherUniversePending.get(exchangeId);
    if (pending) return pending;
    const promise = this.loadOtherSymbols(exchangeId);
    this.otherUniversePending.set(exchangeId, promise);
    try {
      const symbols = await promise;
      if (symbols.length === 0) throw new Error(`No active USDT perpetuals returned by ${exchangeId}`);
      this.otherUniverseCache.set(exchangeId, { until: Date.now() + 300000, symbols });
      return symbols;
    } catch (e) {
      if (cached?.symbols.length) return cached.symbols;
      throw e;
    } finally {
      this.otherUniversePending.delete(exchangeId);
    }
  }

  private async loadOtherSymbols(exchangeId: ExchangeId): Promise<SymbolMeta[]> {
    type RawContract = { symbol: string; base?: string; price?: number; change?: number; volume?: number;
      leverage?: number; tick?: number; step?: number; minNotional?: number; funding?: number | null };
    let contracts: RawContract[] = [];
    const num = (v: any) => Number.isFinite(Number(v)) ? Number(v) : 0;

    switch (exchangeId) {
      case 'binance': {
        const [info, tickers] = await Promise.all([
          this.getJson('https://fapi.binance.com/fapi/v1/exchangeInfo'),
          this.getJson('https://fapi.binance.com/fapi/v1/ticker/24hr')
        ]);
        const tick = new Map((Array.isArray(tickers) ? tickers : []).map((t: any) => [t.symbol, t]));
        contracts = (info.symbols || [])
          .filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' &&
            s.quoteAsset === 'USDT' && s.marginAsset === 'USDT' && s.symbol?.endsWith('USDT'))
          .map((s: any) => {
            const t: any = tick.get(s.symbol) || {};
            return { symbol: s.symbol, base: s.baseAsset, price: num(t.lastPrice), change: num(t.priceChangePercent),
              volume: num(t.quoteVolume), tick: num(s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER')?.tickSize),
              step: num(s.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.stepSize),
              minNotional: num(s.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL')?.notional) };
          });
        break;
      }
      case 'okx': {
        const [info, tickers] = await Promise.all([
          this.getJson('https://www.okx.com/api/v5/public/instruments?instType=SWAP'),
          this.getJson('https://www.okx.com/api/v5/market/tickers?instType=SWAP')
        ]);
        if (info.code !== '0' || tickers.code !== '0') throw new Error('OKX API error');
        const tick = new Map((tickers.data || []).map((t: any) => [t.instId, t]));
        contracts = (info.data || [])
          .filter((s: any) => s.instId?.endsWith('-USDT-SWAP') && s.settleCcy === 'USDT' && s.state === 'live')
          .map((s: any) => {
            const t: any = tick.get(s.instId) || {};
            const last = num(t.last);
            const open = num(t.open24h);
            return { symbol: s.instId.replace(/-/g, '').replace(/SWAP$/, ''), base: s.instId.split('-')[0],
              price: last, change: open > 0 ? (last / open - 1) * 100 : NaN,
              volume: num(t.volCcy24h) * last, tick: num(s.tickSz), step: num(s.lotSz) };
          });
        break;
      }
      case 'bitget': {
        const [info, tickers] = await Promise.all([
          this.getJson('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES'),
          this.getJson('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES')
        ]);
        if (info.code !== '00000' || tickers.code !== '00000') throw new Error('Bitget API error');
        const tick = new Map((tickers.data || []).map((t: any) => [t.symbol, t]));
        contracts = (info.data || []).filter((s: any) => s.symbol?.endsWith('USDT') &&
          s.quoteCoin === 'USDT' && (!s.symbolStatus || s.symbolStatus === 'normal'))
          .map((s: any) => {
            const t: any = tick.get(s.symbol) || {};
            return { symbol: s.symbol, base: s.baseCoin, price: num(t.lastPr),
              change: num(t.change24h) * 100, volume: num(t.usdtVolume || t.quoteVolume), funding: num(t.fundingRate) * 100,
              leverage: num(s.maxLever), step: Number(`1e-${num(s.volumePlace)}`),
              tick: Number(`1e-${num(s.pricePlace)}`) };
          });
        break;
      }
      case 'kucoin': {
        const result = await this.getJson('https://api-futures.kucoin.com/api/v1/contracts/active');
        if (result.code !== '200000') throw new Error('KuCoin API error');
        contracts = (result.data || []).filter((s: any) =>
          s.quoteCurrency === 'USDT' && s.settleCurrency === 'USDT' &&
          s.status === 'Open' && !s.expireDate)
          .map((s: any) => {
            const base = String(s.baseCurrency || '').toUpperCase();
            const normalized = base === 'XBT' ? 'BTC' : base;
            return { symbol: normalized + 'USDT', base: normalized, price: num(s.lastTradePrice || s.markPrice),
              change: num(s.priceChgPct) * 100, volume: num(s.turnoverOf24h),
              funding: num(s.fundingFeeRate) * 100,
              leverage: num(s.maxLeverage),
              tick: num(s.tickSize), step: num(s.lotSize) };
          });
        break;
      }
      case 'gateio': {
        const [list, tickers] = await Promise.all([
          this.getJson('https://api.gateio.ws/api/v4/futures/usdt/contracts?limit=2000&offset=0'),
          this.getJson('https://api.gateio.ws/api/v4/futures/usdt/tickers')
        ]);
        if (!Array.isArray(list) || !Array.isArray(tickers)) throw new Error('Gate futures response invalid');
        const tick = new Map(tickers.map((t: any) => [t.contract, t]));
        contracts = list.filter((s: any) => String(s.name).endsWith('_USDT') &&
          !s.in_delisting && !s.is_delisted && s.type !== 'inverse')
          .map((s: any) => {
            const t: any = tick.get(s.name) || {};
            const base = String(s.name).split('_')[0];
            return { symbol: base + 'USDT', base, price: num(t.last),
              change: num(t.change_percentage), volume: num(t.volume_24h_quote),
              leverage: num(s.leverage_max), tick: num(s.order_price_round),
              step: num(s.order_size_min), funding: num(t.funding_rate) * 100 };
          });
        break;
      }
      case 'mexc': {
        const [info, tickers] = await Promise.all([
          this.getJson('https://contract.mexc.com/api/v1/contract/detail'),
          this.getJson('https://contract.mexc.com/api/v1/contract/ticker')
        ]);
        if (!info.success || !tickers.success) throw new Error('MEXC API error');
        const arr = Array.isArray(tickers.data) ? tickers.data : [tickers.data];
        const tick = new Map(arr.map((t: any) => [t.symbol, t]));
        contracts = (info.data || []).filter((s: any) => s.quoteCoin === 'USDT' &&
          s.settleCoin === 'USDT' && s.symbol?.endsWith('_USDT') && s.state === 0)
          .map((s: any) => {
            const t: any = tick.get(s.symbol) || {};
            return { symbol: String(s.symbol).replace('_', ''), base: s.baseCoin,
              price: num(t.lastPrice), change: num(t.riseFallRate) * 100,
              volume: num(t.amount24), leverage: num(s.maxLeverage),
              tick: num(s.priceUnit) || Number(`1e-${num(s.priceScale)}`),
              step: num(s.volUnit) || Number(`1e-${num(s.volScale)}`), funding: num(t.fundingRate) * 100 };
          });
        break;
      }
      default: throw new Error(`Unsupported exchange: ${exchangeId}`);
    }

    const decimalPlaces = (value: number) => {
      if (value <= 0) return 0;
      const plain = value.toString();
      if (plain.includes('e-')) return Number(plain.split('e-')[1]);
      return plain.includes('.') ? plain.split('.')[1].length : 0;
    };
    const unique = new Map<string, SymbolMeta>();
    for (const s of contracts) {
      if (!s.symbol || !/^[A-Z0-9]+USDT$/.test(s.symbol)) continue;
      unique.set(s.symbol, {
        symbol: s.symbol, baseAsset: s.base || s.symbol.slice(0, -4), quoteAsset: 'USDT',
        exchange: exchangeId, maxLeverage: s.leverage || 0, minNotional: s.minNotional || 0,
        pricePrecision: decimalPlaces(s.tick || 0), quantityPrecision: decimalPlaces(s.step || 0),
        category: DEFAULT_PERPETUAL_SYMBOLS.find((v) => v.symbol === s.symbol)?.category || 'Other',
        lastPrice: s.price || 0, change24h: s.change ?? NaN, volume24h: s.volume || 0,
        fundingRate: s.funding ?? null
      });
    }
    return [...unique.values()].sort((a,b) => a.symbol.localeCompare(b.symbol));
  }

  getSymbols(exchangeId: ExchangeId): SymbolMeta[] {
    return DEFAULT_PERPETUAL_SYMBOLS.map((s) => ({
      ...s,
      exchange: exchangeId,
      maxLeverage: exchangeId === 'binance' && s.symbol === 'BTCUSDT' ? 125 : s.maxLeverage
    }));
  }

  getSymbolMeta(exchangeId: ExchangeId, symbol: string): SymbolMeta | undefined {
    return this.getSymbols(exchangeId).find((s) => s.symbol.toUpperCase() === symbol.toUpperCase());
  }

  /**
   * Main entry point for retrieving historical OHLCV data.
   * Downloads real market data from public exchange APIs, caches locally on disk,
   * performs incremental updates, and aggregates to the requested timeframe.
   * If the real data cannot be retrieved, throws an informative error (no fake data!).
   */
  async getOHLCVCandles(
    exchangeId: ExchangeId,
    symbol: string,
    timeframeMinutes: number,
    requiredCount = 1000,
    live = false
  ): Promise<OHLCV[]> {
    // Native Bybit intervals are more accurate and far cheaper to fetch than
    // reconstructing 1y of weekly/monthly candles from 5m data. Custom 10m,
    // 20m, ... intervals continue to aggregate exchange 5m candles.
    const nativeBybitInterval = exchangeId === 'bybit' &&
      [5, 15, 30, 60, 120, 240, 1440, 10080, 43200].includes(timeframeMinutes);
    const isMultipleOf5 = timeframeMinutes % 5 === 0;
    const baseIntervalMinutes = nativeBybitInterval ? timeframeMinutes : isMultipleOf5 ? 5 : 1;
    const aggregationFactor = timeframeMinutes / baseIntervalMinutes;
    const baseCandlesNeeded = Math.ceil(requiredCount * aggregationFactor);

    const baseCandles = await this.fetchAndCacheRealBaseCandles(
      exchangeId,
      symbol.toUpperCase(),
      baseIntervalMinutes,
      baseCandlesNeeded,
      live
    );

    if (baseCandles.length === 0) {
      throw new Error(`No historical market data available from ${exchangeId} for ${symbol}.`);
    }

    // If no aggregation needed, return directly
    if (aggregationFactor === 1) {
      return baseCandles.slice(-requiredCount);
    }

    // Aggregate lower-timeframe candles to higher-timeframe without future-data leakage
    return this.aggregateCandles(baseCandles, timeframeMinutes).slice(-requiredCount);
  }

  /** Cursor-paginated older candles for the chart's one-year lazy history. */
  async getOHLCVCandlesBefore(
    exchangeId: ExchangeId,
    symbol: string,
    timeframeMinutes: number,
    beforeSeconds: number,
    requestedCount = 1000
  ): Promise<OHLCV[]> {
    const count = Math.max(1, Math.min(1000, Math.floor(requestedCount)));
    const nativeBybitInterval = exchangeId === 'bybit' &&
      [5, 15, 30, 60, 120, 240, 1440, 10080, 43200].includes(timeframeMinutes);
    const baseInterval = nativeBybitInterval ? timeframeMinutes : timeframeMinutes % 5 === 0 ? 5 : 1;
    const factor = timeframeMinutes / baseInterval;
    const normalizedSymbol = symbol.toUpperCase();
    const cacheFile = path.join(this.cacheDir, `${exchangeId}_${normalizedSymbol}_${baseInterval}m_base.json`);
    const cached: OHLCV[] = this.readCandleCache(cacheFile);

    const buildPage = (base: OHLCV[]) => {
      // Only the base candles needed for this page are aggregated, instead of
      // re-aggregating a whole year for every 1,000-bar page.
      const end = lowerBound(base, beforeSeconds);
      const start = Math.max(0, end - Math.ceil(count * factor) - Math.ceil(factor) * 2);
      const window = base.slice(start, end);
      const candles = factor === 1 ? window : this.aggregateCandles(window, timeframeMinutes);
      return candles.filter((c) => c.time < beforeSeconds).slice(-count);
    };
    let page = buildPage(cached);
    // Only return cached data if it covers the whole requested page. Otherwise
    // fetch the older cursor from the exchange rather than looping on a short
    // cache snapshot and claiming one year was loaded.
    if (page.length >= count) return page;

    const oldestCached = cached.length ? cached[0].time : Infinity;
    const additional = await this.downloadPaginatedKlines(
      exchangeId, normalizedSymbol, baseInterval,
      Math.ceil(count * factor) + factor * 2,
      Math.min(beforeSeconds * 1000 - 1, oldestCached * 1000 - 1)
    );
    if (additional.length === 0) return page;
    const merged = new Map<number, OHLCV>();
    cached.forEach((c) => merged.set(c.time, c));
    additional.forEach((c) => merged.set(c.time, c));
    const all = [...merged.values()].sort((a, b) => a.time - b.time);
    this.writeCandleCache(cacheFile, all, false);
    return buildPage(all);
  }

  /**
   * Fetches real base candles using pagination and incremental disk caching.
   */
  private async fetchAndCacheRealBaseCandles(
    exchangeId: ExchangeId,
    symbol: string,
    intervalMinutes: number,
    targetCount: number,
    live = false
  ): Promise<OHLCV[]> {
    const cacheFile = path.join(this.cacheDir, `${exchangeId}_${symbol}_${intervalMinutes}m_base.json`);
    const cachedCandles: OHLCV[] = this.readCandleCache(cacheFile);

    const intervalSec = intervalMinutes * 60;
    const nowSec = Math.floor(Date.now() / 1000);
    const earliestRequiredSec = nowSec - Math.max(0, targetCount - 2) * intervalSec;

    // Check if cached data already satisfies the requested count and is reasonably fresh (< 15 mins old)
    const isCacheFresh = cachedCandles.length > 0 && (nowSec - cachedCandles[cachedCandles.length - 1].time) < 900;
    const hasEnoughHistory = cachedCandles.length >= targetCount && cachedCandles[0].time <= earliestRequiredSec;

    // Live chart requests update the current (still forming) bar independently
    // of the 15-minute historical cache. Keep REST calls bounded across viewers.
    const liveKey = `${exchangeId}:${symbol}:${intervalMinutes}`;
    const recentEnoughForIncremental = cachedCandles.length > 0 &&
      nowSec - cachedCandles[cachedCandles.length - 1].time <= intervalSec * 10;
    if (live && hasEnoughHistory && recentEnoughForIncremental) {
      if (Date.now() - (this.liveRefreshAt.get(liveKey) || 0) < 2500) return cachedCandles;
      try {
        const recent = await this.fetchSingleExchangeKlines(exchangeId, symbol, intervalMinutes, Date.now(), 10);
        const updated = mergeTail(cachedCandles, recent);
        // Memory is updated immediately; the multi-MB disk cache is persisted
        // at most every 30 s instead of on every 2.5 s live poll.
        this.writeCandleCache(cacheFile, updated, false);
        this.liveRefreshAt.set(liveKey, Date.now());
        return updated;
      } catch (err: any) {
        console.warn(`Live refresh failed for ${symbol}: ${err.message}`);
        // Return history; the client must not label the cached snapshot as fresh.
        throw new Error(`Live candle refresh failed: ${err.message}`);
      }
    }

    if (isCacheFresh && hasEnoughHistory && !live) {
      return cachedCandles;
    }

    // Download only what the cache is missing. Previously every stale-cache
    // request re-downloaded the FULL history (~106 Bybit pages per symbol for
    // a 1-year 5m backtest) even when only the last few bars were new.
    try {
      const fetchedParts: OHLCV[][] = [];
      if (cachedCandles.length === 0) {
        fetchedParts.push(await this.downloadPaginatedKlines(exchangeId, symbol, intervalMinutes, targetCount));
      } else {
        const newestCached = cachedCandles[cachedCandles.length - 1].time;
        const missingRecent = Math.ceil((nowSec - newestCached) / intervalSec) + 2;
        fetchedParts.push(await this.downloadPaginatedKlines(
          exchangeId, symbol, intervalMinutes, Math.min(targetCount, missingRecent)
        ));
        const oldestCached = cachedCandles[0].time;
        if (oldestCached > earliestRequiredSec) {
          const missingOlder = Math.ceil((oldestCached - earliestRequiredSec) / intervalSec) + 2;
          fetchedParts.push(await this.downloadPaginatedKlines(
            exchangeId, symbol, intervalMinutes, missingOlder, oldestCached * 1000 - 1
          ));
        }
        // If the recent download could not reach the cache, refetch fully so
        // a gap is never left in the middle of the history.
        const recent = fetchedParts[0];
        if (recent.length && recent[0].time > newestCached + intervalSec) {
          fetchedParts[0] = await this.downloadPaginatedKlines(exchangeId, symbol, intervalMinutes, targetCount);
        }
      }

      // Merge cached and fetched candles, deduplicate by timestamp, sort ascending
      const map = new Map<number, OHLCV>();
      cachedCandles.forEach((c) => map.set(c.time, c));
      fetchedParts.forEach((part) => part.forEach((c) => map.set(c.time, c)));

      const merged = Array.from(map.values()).sort((a, b) => a.time - b.time);

      // Validate candle order and verify timestamps are strictly increasing
      const validated: OHLCV[] = [];
      for (let i = 0; i < merged.length; i++) {
        if (i === 0 || merged[i].time > merged[i - 1].time) {
          validated.push(merged[i]);
        }
      }

      this.writeCandleCache(cacheFile, validated, true);
      return validated;
    } catch (err: any) {
      // If network fails but we have some cached data, return what we have; otherwise throw real error
      if (cachedCandles.length > 0) {
        console.warn(`Network fetch failed for ${symbol}, using existing ${cachedCandles.length} cached bars:`, err.message);
        return cachedCandles;
      }
      throw new Error(`Exchange [${exchangeId.toUpperCase()}] API request failed for ${symbol}: ${err.message}`);
    }
  }

  /**
   * Download paginated real klines from public endpoints with backoff
   */
  private async downloadPaginatedKlines(
    exchangeId: ExchangeId,
    symbol: string,
    intervalMinutes: number,
    targetCount: number,
    initialEndTimeMs = Date.now()
  ): Promise<OHLCV[]> {
    let collected: OHLCV[] = [];
    let endTimeMs = initialEndTimeMs;
    // A year of 5m candles needs ~106 Bybit pages. The old 15-page ceiling
    // silently truncated long backtests to only a few weeks.
    const pageCapacity = exchangeId === 'bybit' ? 1000 : exchangeId === 'binance' ? 1500 :
      (exchangeId === 'okx' || exchangeId === 'bitget' ? 100 : 500);
    const maxPages = Math.min(1200, Math.ceil(targetCount / pageCapacity) + 2);

    for (let page = 0; page < maxPages; page++) {
      if (collected.length >= targetCount) break;

      const pageCandles = await this.fetchSingleKlinesPageWithRetry(
        exchangeId,
        symbol,
        intervalMinutes,
        endTimeMs
      );

      if (!pageCandles || pageCandles.length === 0) break;

      // pageCandles is sorted ascending
      collected = [...pageCandles, ...collected];
      const oldestTimeMs = pageCandles[0].time * 1000;
      endTimeMs = oldestTimeMs - 1;

      // Avoid hitting rate limits
      await new Promise((r) => setTimeout(r, 60));
    }

    // Deduplicate and sort ascending
    const map = new Map<number, OHLCV>();
    collected.forEach((c) => map.set(c.time, c));
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Fetches a single page of klines from the specified exchange with exponential backoff
   */
  private async fetchSingleKlinesPageWithRetry(
    exchangeId: ExchangeId,
    symbol: string,
    intervalMinutes: number,
    endTimeMs: number
  ): Promise<OHLCV[]> {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        return await this.fetchSingleExchangeKlines(exchangeId, symbol, intervalMinutes, endTimeMs);
      } catch (err: any) {
        if (attempts >= maxAttempts) throw err;
        // Exponential backoff
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempts)));
      }
    }
    return [];
  }

  /**
   * Direct exchange adapter implementations for USDT perpetual futures
   */
  private async fetchSingleExchangeKlines(
    exchangeId: ExchangeId,
    symbol: string,
    intervalMinutes: number,
    endTimeMs: number,
    requestedLimit = 1000
  ): Promise<OHLCV[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      if (exchangeId === 'bybit') {
        // Bybit V5 Linear Kline
        const bybitSym = toBybitContractSymbol(symbol);
        const intervalStr = intervalMinutes === 1440 ? 'D' :
          intervalMinutes === 10080 ? 'W' :
          intervalMinutes === 43200 ? 'M' : intervalMinutes.toString();
        const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSym}&interval=${intervalStr}&limit=${Math.min(1000, requestedLimit)}&end=${endTimeMs}`;
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (json.retCode !== 0) throw new Error(json.retMsg || 'Bybit API Error');

        const list = json.result?.list || [];
        // Bybit returns list descending: [startTime, open, high, low, close, volume, turnover]
        return list.slice().reverse().map((item: string[]) => ({
          time: Math.floor(Number(item[0]) / 1000),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
          volume: Number(item[5])
        }));
      }

      if (exchangeId === 'binance') {
        // Binance USDT-M Futures Kline
        const binanceMemeMap: Record<string, string> = {
          PEPEUSDT: '1000PEPEUSDT',
          SHIBUSDT: '1000SHIBUSDT',
          BONKUSDT: '1000BONKUSDT',
          FLOKIUSDT: '1000FLOKIUSDT',
          BOMEUSDT: '1000BOMEUSDT'
        };
        const binanceSym = binanceMemeMap[symbol] || symbol;
        const tfMap: Record<number, string> = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 1440: '1d' };
        const interval = tfMap[intervalMinutes] || `${intervalMinutes}m`;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSym}&interval=${interval}&limit=1500&endTime=${endTimeMs}`;
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error('Invalid Binance format');

        return list.map((item: any[]) => ({
          time: Math.floor(Number(item[0]) / 1000),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
          volume: Number(item[5])
        }));
      }

      if (exchangeId === 'okx') {
        // OKX Perpetual Swap Candles
        // OKX symbol format: BTC-USDT-SWAP
        const instId = symbol.includes('-SWAP') ? symbol : `${symbol.replace('USDT', '')}-USDT-SWAP`;
        const tfMap: Record<number, string> = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1H', 120: '2H', 240: '4H' };
        const bar = tfMap[intervalMinutes] || `${intervalMinutes}m`;
        const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=100&after=${endTimeMs}`;
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (json.code !== '0') throw new Error(json.msg || 'OKX API error');

        const data = json.data || [];
        // OKX returns descending: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
        return data.slice().reverse().map((item: string[]) => ({
          time: Math.floor(Number(item[0]) / 1000),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
          volume: Number(item[5])
        }));
      }

      if (exchangeId === 'bitget') {
        // Bitget USDT Futures Candles
        const tfMap: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h' };
        const gran = tfMap[intervalMinutes] || `${intervalMinutes}m`;
        const url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&granularity=${gran}&limit=100&productType=USDT-FUTURES&endTime=${endTimeMs}`;
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (json.code !== '00000') throw new Error(json.msg || 'Bitget error');

        const data = json.data || [];
        // [ts, open, high, low, close, baseVol, quoteVol]
        return data.slice().reverse().map((item: string[]) => ({
          time: Math.floor(Number(item[0]) / 1000),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
          volume: Number(item[5])
        }));
      }

      if (exchangeId === 'gateio') {
        // Gate.io USDT Futures Candlesticks
        // contract format: BTC_USDT
        const contract = symbol.includes('_') ? symbol : `${symbol.replace('USDT', '')}_USDT`;
        const toSec = Math.floor(endTimeMs / 1000);
        const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=${intervalMinutes}m&limit=1000&to=${toSec}`;
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Gate.io returned invalid format');

        // [{ t, o, c, h, l, v, sum }]
        return data.map((item: any) => ({
          time: Number(item.t),
          open: Number(item.o),
          high: Number(item.h),
          low: Number(item.l),
          close: Number(item.c),
          volume: Number(item.v)
        })).sort((a: OHLCV, b: OHLCV) => a.time - b.time);
      }

      if (exchangeId === 'kucoin') {
        // KuCoin Futures
        // symbol: XBTUSDTM, etc.
        const kucoinSym = symbol === 'BTCUSDT' ? 'XBTUSDTM' : `${symbol.replace('USDT', '')}USDTM`;
        const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${kucoinSym}&granularity=${intervalMinutes}&to=${endTimeMs}`;
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (json.code !== '200000') throw new Error(json.msg || 'KuCoin error');

        const data = json.data || [];
        // [[time, open, high, low, close, volume, turnover], ...]
        return data.map((item: any[]) => ({
          time: Math.floor(Number(item[0]) / 1000),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
          volume: Number(item[5])
        })).sort((a: OHLCV, b: OHLCV) => a.time - b.time);
      }

      if (exchangeId === 'mexc') {
        // MEXC Perpetual Futures
        // contract: BTC_USDT
        const contract = symbol.includes('_') ? symbol : `${symbol.replace('USDT', '')}_USDT`;
        const url = `https://contract.mexc.com/api/v1/contract/kline/${contract}?interval=Min${intervalMinutes}&end=${Math.floor(endTimeMs / 1000)}`;
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (!json.success || !json.data) throw new Error('MEXC API error');

        const d = json.data;
        const result: OHLCV[] = [];
        for (let i = 0; i < (d.time?.length || 0); i++) {
          result.push({
            time: Number(d.time[i]),
            open: Number(d.open[i]),
            high: Number(d.high[i]),
            low: Number(d.low[i]),
            close: Number(d.close[i]),
            volume: Number(d.vol[i])
          });
        }
        return result.sort((a, b) => a.time - b.time);
      }

      throw new Error(`Exchange ${exchangeId} is not supported`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Aggregates lower-timeframe candles into higher-timeframe candles
   * strictly aligned to exchange boundaries (UTC 00:00) without future lookahead.
   */
  aggregateCandles(baseCandles: OHLCV[], targetMinutes: number): OHLCV[] {
    if (baseCandles.length === 0) return [];

    const bucketSeconds = targetMinutes * 60;
    const bucketMap = new Map<number, OHLCV[]>();

    for (const c of baseCandles) {
      // Exchange-aligned candle boundary
      const bucketTime = Math.floor(c.time / bucketSeconds) * bucketSeconds;
      let list = bucketMap.get(bucketTime);
      if (!list) {
        list = [];
        bucketMap.set(bucketTime, list);
      }
      list.push(c);
    }

    const aggregated: OHLCV[] = [];
    const sortedBucketTimes = Array.from(bucketMap.keys()).sort((a, b) => a - b);

    for (const bucketTime of sortedBucketTimes) {
      const group = bucketMap.get(bucketTime)!;
      group.sort((a, b) => a.time - b.time);
      // The first bucket of a history window usually starts mid-interval
      // (e.g. 10:05 for a 10:00 15m bar). Its open/high/low would be wrong,
      // so a leading partial bucket is dropped rather than shown as real.
      if (aggregated.length === 0 && bucketTime === sortedBucketTimes[0] &&
          group[0].time !== bucketTime && sortedBucketTimes.length > 1) {
        continue;
      }

      const open = group[0].open;
      const close = group[group.length - 1].close;
      let high = group[0].high;
      let low = group[0].low;
      let volume = 0;

      for (const item of group) {
        if (item.high > high) high = item.high;
        if (item.low < low) low = item.low;
        volume += item.volume;
      }

      aggregated.push({
        time: bucketTime,
        open,
        high,
        low,
        close,
        volume: Number(volume.toFixed(4))
      });
    }

    return aggregated;
  }
}

/** First index whose time is >= target (array sorted ascending by time). */
export function lowerBound(candles: OHLCV[], targetTime: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].time < targetTime) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Replace/append a small sorted tail of recent candles without re-sorting the
 * full history. Falls back to a full merge if the tail overlaps oddly.
 */
export function mergeTail(history: OHLCV[], recent: OHLCV[]): OHLCV[] {
  if (!recent.length) return history;
  const sortedRecent = [...recent].sort((a, b) => a.time - b.time);
  const start = lowerBound(history, sortedRecent[0].time);
  const tail = history.slice(start);
  const merged = new Map<number, OHLCV>();
  tail.forEach((c) => merged.set(c.time, c));
  sortedRecent.forEach((c) => merged.set(c.time, c));
  return history.slice(0, start).concat([...merged.values()].sort((a, b) => a.time - b.time));
}

export const exchangeService = new ExchangeDataService();
