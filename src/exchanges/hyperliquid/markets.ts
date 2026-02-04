import type { Market } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { HyperliquidClients } from "./client.js";

/**
 * Fetch all available markets from Hyperliquid
 * Maps Hyperliquid universe to common Market type
 */
export async function getMarkets(clients: HyperliquidClients): Promise<Market[]> {
  logger.debug("Fetching markets from Hyperliquid");

  // Fetch metadata which includes the universe of all perpetual markets
  const meta = await clients.info.meta();

  // Map each asset in universe to our common Market type
  const markets: Market[] = meta.universe.map((asset, index) => {
    // Parse the asset name (e.g., "BTC", "ETH")
    const base = asset.name;
    const quote = "USD"; // Hyperliquid perps are quoted in USD

    // Hyperliquid uses szDecimals for size precision
    const sizePrecision = asset.szDecimals;

    // Price precision is not directly in meta, but we can infer it
    // Hyperliquid typically uses 1-5 decimal places for price depending on the asset
    // For simplicity, we'll use a reasonable default of 2 for most assets
    // and 5 for lower-priced assets (this can be refined later)
    const pricePrecision = getPricePrecision(base);

    // Calculate tick size based on price precision
    const tickSize = 10 ** -pricePrecision;

    // Calculate min size based on size precision
    const minSize = 10 ** -sizePrecision;

    return {
      id: String(index), // Asset index as the market ID
      symbol: `${base}/${quote}:${quote}`, // CCXT-style symbol format
      base,
      quote,
      pricePrecision,
      sizePrecision,
      minSize,
      tickSize,
      raw: asset, // Store original asset data
    };
  });

  logger.info(`Loaded ${markets.length} markets from Hyperliquid`);

  return markets;
}

/**
 * Infer price precision based on asset name
 * This is a heuristic and may need adjustment based on actual market data
 */
function getPricePrecision(assetName: string): number {
  // Common crypto assets typically have different price precisions
  // High-value assets (BTC, ETH) use fewer decimals
  // Low-value assets use more decimals

  const lowerName = assetName.toLowerCase();

  // High-value assets - typically 1-2 decimals
  if (lowerName === "btc" || lowerName === "eth") {
    return 1;
  }

  // Mid-value assets - typically 2-3 decimals
  if (
    lowerName === "bnb" ||
    lowerName === "sol" ||
    lowerName === "avax" ||
    lowerName === "matic" ||
    lowerName === "atom"
  ) {
    return 2;
  }

  // Most other assets - 3-4 decimals
  if (lowerName.endsWith("usdt") || lowerName.endsWith("usdc")) {
    return 4;
  }

  // Default for most altcoins
  return 4;
}

/**
 * Get a market by symbol (e.g., "BTC" or "BTC/USD:USD")
 */
export async function getMarketBySymbol(
  clients: HyperliquidClients,
  symbol: string
): Promise<Market | undefined> {
  const markets = await getMarkets(clients);

  // Support both "BTC" and "BTC/USD:USD" format
  const normalizedSymbol = symbol.includes("/") ? symbol : `${symbol}/USD:USD`;

  return markets.find((m) => m.symbol === normalizedSymbol);
}

/**
 * Get market by asset index
 */
export async function getMarketByIndex(
  clients: HyperliquidClients,
  index: number
): Promise<Market | undefined> {
  const markets = await getMarkets(clients);
  return markets.find((m) => m.id === String(index));
}
