import { logger } from "../utils/logger.js";
import { BinancePriceFeed, type PriceCallback } from "./binance.js";
import { HyperliquidPriceFeed } from "./hyperliquid.js";

export type PriceSource = "binance" | "hyperliquid";

/**
 * Common interface for price feeds
 */
export interface IPriceFeed {
  connect(): Promise<void>;
  disconnect(): void;
  getLastPrice(): number | null;
  getLastTimestamp(): number | null;
  readonly connected: boolean;
}

/**
 * Create a price feed by source name
 * @param source - Price source ("binance" or "hyperliquid")
 * @param symbol - Trading symbol (e.g., "BTC")
 * @param callback - Called on each price update
 * @param options - Additional options (e.g., isTestnet for Hyperliquid)
 */
export function createPriceFeed(
  source: PriceSource,
  symbol: string,
  callback: PriceCallback,
  options?: { isTestnet?: boolean }
): IPriceFeed {
  logger.info(`Creating price feed: ${source} for ${symbol}`);

  switch (source.toLowerCase()) {
    case "binance":
      return new BinancePriceFeed(symbol, callback);

    case "hyperliquid":
      return new HyperliquidPriceFeed(symbol, callback, options?.isTestnet ?? false);

    default:
      throw new Error(`Unknown price source: ${source}. Supported: binance, hyperliquid`);
  }
}

/**
 * Get list of supported price sources
 */
export function getSupportedPriceSources(): PriceSource[] {
  return ["binance", "hyperliquid"];
}

// Re-export
export { BinancePriceFeed, type PriceCallback } from "./binance.js";
export { HyperliquidPriceFeed } from "./hyperliquid.js";
export { FairPriceCalculator, createFairPriceCalculator } from "./fair-price.js";
