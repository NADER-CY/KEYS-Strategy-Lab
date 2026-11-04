/**
 * Bybit lists several low-priced coins only as 1000x (or x1000) linear
 * contracts. Klines, funding history and instrument limits must all query the
 * SAME contract, otherwise funding/leverage silently come from a different
 * (or non-existent) market.
 */
export const BYBIT_CONTRACT_ALIASES: Record<string, string> = {
  PEPEUSDT: '1000PEPEUSDT',
  SHIBUSDT: 'SHIB1000USDT',
  BONKUSDT: '1000BONKUSDT',
  FLOKIUSDT: '1000FLOKIUSDT',
  BOMEUSDT: '1000BOMEUSDT',
  NEIROUSDT: '1000NEIROCTOUSDT'
};

export function toBybitContractSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase();
  return BYBIT_CONTRACT_ALIASES[normalized] || normalized;
}
