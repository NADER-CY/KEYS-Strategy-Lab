/** Simulated next-bar execution price; never round to fiat cents. */
export function calculateExecutedEntryPrice(
  candleOpen: number,
  side: 'BUY' | 'SELL',
  slippagePct: number
): number {
  if (!Number.isFinite(candleOpen) || candleOpen <= 0) throw new Error('Invalid candle open');
  if (!Number.isFinite(slippagePct) || slippagePct < 0 || slippagePct >= 100) throw new Error('Invalid slippage');
  return candleOpen * (side === 'BUY' ? 1 + slippagePct / 100 : 1 - slippagePct / 100);
}

/**
 * Simulated market exit at a marked price. Slippage is always adverse:
 * closing a long sells below the mark, closing a short buys above it.
 */
export function calculateExecutedExitPrice(
  markPrice: number,
  side: 'BUY' | 'SELL',
  slippagePct: number
): number {
  if (!Number.isFinite(markPrice) || markPrice <= 0) throw new Error('Invalid exit mark price');
  if (!Number.isFinite(slippagePct) || slippagePct < 0 || slippagePct >= 100) throw new Error('Invalid slippage');
  return markPrice * (side === 'BUY' ? 1 - slippagePct / 100 : 1 + slippagePct / 100);
}
