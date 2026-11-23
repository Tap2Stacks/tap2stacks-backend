export const SUPPORTED_TICKERS = ['NVDA', 'TSLA', 'AAPL', 'SP500'] as const;

export type SupportedTicker = (typeof SUPPORTED_TICKERS)[number];

export const SUPPORTED_TICKER_SET: ReadonlySet<string> = new Set<string>(
  SUPPORTED_TICKERS,
);

export const HYPERLIQUID_PRICE_SOURCE = 'hyperliquid-xyz-perp' as const;

export function isSupportedTicker(ticker: unknown): ticker is SupportedTicker {
  return typeof ticker === 'string' && SUPPORTED_TICKER_SET.has(ticker);
}
