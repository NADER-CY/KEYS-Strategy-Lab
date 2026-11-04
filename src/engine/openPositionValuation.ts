import { PositionTrade } from '../types';

/** Mark historical open trades without fabricating an exit order at backtest end. */
export function markOpenPositionsAtEnd(
  positions: PositionTrade[],
  closingPrice: (symbol: string) => number | undefined
): number {
  let totalUnrealized = 0;
  for (const trade of positions) {
    const price = closingPrice(trade.symbol);
    if (trade.status !== 'OPEN' || !Number.isFinite(price) || !price || price <= 0) {
      throw new Error(`Cannot value open ${trade.symbol} position at backtest end`);
    }
    const pct = (trade.side === 'BUY' ? price - trade.entryPrice : trade.entryPrice - price) / trade.entryPrice;
    const grossPnl = trade.notional * pct;
    trade.pnlUsdt = Number(grossPnl.toFixed(4));
    trade.pnlPct = Number((grossPnl / trade.margin * 100).toFixed(2));
    // status remains OPEN; no exitPrice, exitTime, exitReason, or exit fee.
    totalUnrealized += grossPnl;
  }
  return totalUnrealized;
}
