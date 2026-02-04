import type { Market } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { AftermathClient } from "./client.js";

/**
 * Aftermath CCXT Market Response
 * Structure returned from GET /api/ccxt/markets
 */
interface AftermathMarket {
  id: string; // Market ID (chId)
  symbol: string; // Symbol format (e.g., "BTC/USDC:USDC")
  base: string; // Base currency (e.g., "BTC")
  quote: string; // Quote currency (e.g., "USDC")
  settle: string; // Settlement currency
  baseId: string;
  quoteId: string;
  settleId: string;
  type: string; // "swap" for perpetuals
  spot: boolean;
  margin: boolean;
  swap: boolean;
  future: boolean;
  option: boolean;
  active: boolean;
  contract: boolean;
  linear: boolean;
  inverse: boolean;
  contractSize: number;
  expiry?: number;
  expiryDatetime?: string;
  strike?: number;
  optionType?: string;
  precision: {
    amount: number; // Size precision
    price: number; // Price precision
    base: number;
    quote: number;
  };
  limits: {
    leverage?: {
      min?: number;
      max?: number;
    };
    amount?: {
      min?: number;
      max?: number;
    };
    price?: {
      min?: number;
      max?: number;
    };
    cost?: {
      min?: number;
      max?: number;
    };
  };
  info: Record<string, unknown>; // Raw market data from Aftermath
}

/**
 * Cache for markets to avoid repeated API calls
 */
let marketsCache: Market[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache TTL

/**
 * Fetch all available markets from Aftermath
 * Maps Aftermath CCXT markets response to common Market type
 */
export async function getMarkets(client: AftermathClient, forceRefresh = false): Promise<Market[]> {
  // Return cached markets if still valid
  const now = Date.now();
  if (!forceRefresh && marketsCache && now - cacheTimestamp < CACHE_TTL_MS) {
    logger.debug(`Returning ${marketsCache.length} cached markets from Aftermath`);
    return marketsCache;
  }

  logger.debug("Fetching markets from Aftermath CCXT API");

  try {
    // Fetch markets from Aftermath CCXT REST API
    const response = await client.get<Record<string, AftermathMarket>>("/api/ccxt/markets");

    // Convert object of markets to array and map to common Market type
    const markets: Market[] = Object.values(response)
      .filter((market) => market.active && market.swap) // Only active perpetual swaps
      .map((market) => {
        // Calculate tick size based on price precision
        const tickSize = 10 ** -market.precision.price;

        // Calculate min size based on amount precision
        const minSize = market.limits.amount?.min ?? 10 ** -market.precision.amount;

        // Max size if available
        const maxSize = market.limits.amount?.max;

        return {
          id: market.id, // Use chId as the market ID
          symbol: market.symbol, // Already in CCXT format (e.g., "BTC/USDC:USDC")
          base: market.base,
          quote: market.quote,
          pricePrecision: market.precision.price,
          sizePrecision: market.precision.amount,
          minSize,
          maxSize,
          tickSize,
          raw: market, // Store original market data
        };
      });

    // Update cache
    marketsCache = markets;
    cacheTimestamp = now;

    logger.info(`Loaded ${markets.length} markets from Aftermath`);

    return markets;
  } catch (error) {
    logger.error("Failed to fetch markets from Aftermath:", error);
    throw error;
  }
}

/**
 * Get a market by symbol (e.g., "BTC/USDC:USDC" or just "BTC")
 */
export async function getMarketBySymbol(
  client: AftermathClient,
  symbol: string
): Promise<Market | undefined> {
  const markets = await getMarkets(client);

  // If symbol doesn't contain '/', try to match by base currency
  if (!symbol.includes("/")) {
    return markets.find((m) => m.base.toLowerCase() === symbol.toLowerCase());
  }

  // Otherwise match by full symbol
  return markets.find((m) => m.symbol === symbol);
}

/**
 * Get a market by chId
 */
export async function getMarketById(
  client: AftermathClient,
  chId: string
): Promise<Market | undefined> {
  const markets = await getMarkets(client);
  return markets.find((m) => m.id === chId);
}

/**
 * Clear the markets cache
 * Useful for testing or when you need fresh data
 */
export function clearMarketsCache(): void {
  marketsCache = null;
  cacheTimestamp = 0;
  logger.debug("Markets cache cleared");
}
