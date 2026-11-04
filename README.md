# KEYS Strategy Lab — Multi-Exchange Backtest Platform

A complete, production-oriented cryptocurrency futures strategy backtesting platform with multi-exchange integration, Pine Script v6 indicator calculation engine, cross-margin portfolio cycle management, 5-stage PnL trailing floor exit rules, and high-readability financial terminal UI.

---

## 1. System Architecture & UI Design Lock

The application strictly adheres to the approved four-page design architecture:

1. **Chart & Backtest (`/`)**:
   - Candlestick chart (~520px height) powered by Lightweight Charts.
   - Clean view by default: standard candlesticks with BUY (`arrowUp`), SELL (`arrowDown`), and EXIT markers with realized PnL text (`EXIT +2.45 USDT`, `EXIT -1.18 USDT`).
   - All indicator lines, overlays, SAR dots, and channel bands are hidden by default to keep the chart uncluttered (with an optional toggle button to display overlays).
   - Sub-tabs for Strategy & Portfolio Management, 5-Stage PnL Rules, Indicator Settings, and Pine Script v6 parser/editor.
   - Bottom Green Action Bar with simulation controls, progress bar, and active position metrics.

2. **Backtest Results**:
   - Master list of historical backtests with real performance metrics (ROI %, Net PnL, Win Rate, Max DD, Profit Factor, Sharpe Ratio).
   - Multi-run comparative analysis modal (compare up to 4 runs simultaneously).
   - Interactive equity curve visualization with area fill and drawdown tracking.
   - Complete trades execution log with export capabilities (JSON report & CSV trade log).

3. **Positions & Charts**:
   - Deep inspection of every individual simulated contract position.
   - Position summary metrics (Win Rate, Average PnL, Best/Worst Trade).
   - Dedicated 520px contract candlestick chart pinpointing exact entry candle, entry price, exit price, and realized PnL.
   - Complete filterable table of simulated positions by Symbol, Side, Outcome (Win/Loss), and Cycle index.

4. **Symbol Universe**:
   - Exchange selector: Bybit, Binance, OKX, Bitget, KuCoin, Gate.io, MEXC.
   - Saved Symbol Group selector with complete CRUD (Save Selection, Save As New Group, Load, Rename, Duplicate, Delete).
   - Dynamic 100-symbol tabs (`1–100`, `101–200`, `201–300`, `301–400`, etc.) with stable alphabetical sorting.
   - Real-time live checkbox counter (e.g., `2 Selected`, never resets or defaults to 50).
   - Quick selection helpers (Select All, Clear All, Top 50, Top 100, Show Selected Only, Search filter).

---

## 2. Global Typography Hierarchy

All tiny 10px and 11px font sizes have been audited and replaced across all four pages with high-readability tabular typography:

| UI Element | Target Size | Applied Tailwind Classes |
|---|---|---|
| Primary Financial Values (Equity, Balance, Net Profit) | 20–24px | `text-xl sm:text-2xl font-bold font-mono tabular-nums` |
| Important Percentages & ROI | 18–22px | `text-lg sm:text-xl font-bold font-mono tabular-nums` |
| Table Numerical Values (Prices, Volumes, Trades) | 15–16px | `text-sm sm:text-base font-mono tabular-nums` |
| Input Values | 16px | `text-base font-mono font-semibold` |
| Input Labels | 13–14px | `text-sm font-medium text-slate-300` |
| Button Labels | 14–15px | `text-sm font-semibold` |
| Section Titles | 17–19px | `text-lg font-bold text-white` |
| Secondary Explanatory Text | 12–13px | `text-xs text-slate-400` |

---

## 3. Authoritative KEYS Pine Script v6 Indicator Logic

The indicator engine faithfully implements the original KEYS Pine Script calculations without approximations:

- **Wilder's RMA Smoothing**: Standard TradingView-compatible exponential moving average (`alpha = 1 / length`).
- **Relative Strength Index (RSI)**: Computed over Wilder's smoothed gains and losses with 14-period default.
- **Directional Movement Index (ADX / +DI / -DI)**: 14-period directional movement smoothing with default ADX trend threshold of 30.
- **Parabolic SAR**: Classic Welles Wilder Parabolic Time/Price system with acceleration factor start `0.02`, increment `0.02`, and maximum `0.20`.
- **Channels & Extremes**: 200-period rolling highest high and lowest low price channels with YPSAR and DPSAR touches.
- **Volume Spike & Wick Anomaly**: Liquidity trap detection based on volume spike exceeding 1.5× 20-period volume SMA and wick ratio exceeding 0.60.
- **Exact Entry Conditions**:
  - `buyCondition = liquidity_trap && rsiOversold && strongTrend && touchDPSAR && close > open`
  - `sellCondition = liquidity_trap && rsiOverbought && strongTrend && touchYPSAR && close < open`
  - SAR Direction Filter: `buySignal = buyCondition && (!useSARFilter || sarBullish)`, `sellSignal = sellCondition && (!useSARFilter || sarBearish)`.

---

## 4. Financial Simulation & Risk Engine

- **Real Exchange Data**: Fetches linear USDT perpetual futures klines from Bybit, Binance, OKX, Bitget, KuCoin, Gate.io, and MEXC. Low-decimal meme coins (PEPE, SHIB, BONK, FLOKI) are automatically mapped to 1000x contract multipliers.
- **Causal Execution (N+1 Open)**: Signals detected at bar $N$ close execute strictly at bar $N+1$ open with slippage (default 0.05%) and taker fees (0.055%). Zero future-bar lookahead leakage.
- **Fixed $10 Notional Position Sizing**: Every position takes $10 USDT notional size ($0.20 initial margin at 50x leverage).
- **Cross-Margin Portfolio Accounting**: Shared balance and equity across all concurrent positions, with 8-hour periodic funding rates (0.01%).
- **5-Stage PnL Trailing Floor Rules**:
  $$\text{Exit Floor} = \text{Peak Net Profit} \times \left(1 - \frac{\text{Profit Drop}}{100}\right)$$
  - Range 1: 50% – 80% (30% drop)
  - Range 2: 81% – 120% (30% drop)
  - Range 3: 121% – 150% (30% drop)
  - Range 4: 151% – 200% (30% drop)
  - Range 5: 201% – 500% (30% drop)
- **Cycle Expiry & Held Defect Fix**: On cycle expiry day (7 days), if basket net PnL is negative ($< 0$), positions are **NOT** liquidated. New entries are frozen, and positions are held until the basket recovers to breakeven ($\ge 0$), at which point the cycle closes and advances.

---

## 5. Automated Validation Suite

Run the full automated test suite:
```bash
npm test
```

### Validation Suite Results (21 / 21 Passed)
- `[Point 01] ✓ PASS — KEYS Signal Formulas (Exact Pine Script Conditions)`
- `[Point 02] ✓ PASS — RSI, ADX, SAR, and Rolling Channel Math`
- `[Point 03] ✓ PASS — No Future-Data Leakage (Causal Correctness)`
- `[Point 04] ✓ PASS — Next-Candle Trade Entry (N+1 Open with Slippage)`
- `[Point 05] ✓ PASS — Historical Data Aggregation (Boundary Aligned)`
- `[Point 06] ✓ PASS — Leverage Validation (Rejection on Contract Exceeded)`
- `[Point 07] ✓ PASS — Fixed $10 Notional Position Sizing & Initial Margin`
- `[Point 08] ✓ PASS — Cross-Margin Portfolio Accounting`
- `[Point 09] ✓ PASS — Entry and Exit Taker Fee Accounting (0.055%)`
- `[Point 10] ✓ PASS — 8-Hour Periodic Funding Rate Accounting`
- `[Point 11] ✓ PASS — 5-Stage PnL Trailing Drop Floor Exit Rules`
- `[Point 12] ✓ PASS — Fixed Floor Preset Mode (+50% Activate, +30% Lock)`
- `[Point 13] ✓ PASS — Cycle Expiry When Profitable (Liquidate & Advance)`
- `[Point 14] ✓ PASS — Cycle Expiry While Losing (Hold & Freeze Entries Defect Fix)`
- `[Point 15] ✓ PASS — Breakeven Liquidation Following Held Expired Cycle`
- `[Point 16] ✓ PASS — Strict Maximum Simultaneous Open Positions Limit`
- `[Point 17] ✓ PASS — Symbol Group Storage Persistence & CRUD`
- `[Point 18] ✓ PASS — Immediate Backtest Job Cancellation & Status Update`
- `[Point 19] ✓ PASS — Real Deterministic Equity Curve Generation`
- `[Point 20] ✓ PASS — Saved Results Integrity & Isolated Demo Mode`
- `[Point 21] ✓ PASS — End-to-End Flow (Select Bybit -> 2 Symbols -> Save -> Signal Validation)`

---

## 6. Development & Deployment

```bash
# Install dependencies
npm install

# Start full-stack server (Node.js/Express + Vite)
npm run dev

# Run type check and lint
npm run lint

# Build for production
npm run build

# Start production server
npm start
```
