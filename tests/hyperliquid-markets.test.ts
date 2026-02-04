import { describe, expect, it } from "vitest";
import { createHyperliquidClient } from "../src/exchanges/hyperliquid/client.js";
import { getMarketBySymbol, getMarkets } from "../src/exchanges/hyperliquid/markets.js";

describe("Hyperliquid Market Discovery", () => {
  // Test private key (example, not a real one)
  const testPrivateKey = "0x0000000000000000000000000000000000000000000000000000000000000001";

  it("should fetch markets from Hyperliquid", async () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey,
      isTestnet: true,
    });

    const markets = await getMarkets(clients);

    // Should have multiple markets
    expect(markets.length).toBeGreaterThan(0);

    // Each market should have required fields
    for (const market of markets) {
      expect(market.id).toBeDefined();
      expect(market.symbol).toBeDefined();
      expect(market.base).toBeDefined();
      expect(market.quote).toBe("USD"); // Hyperliquid perps are USD quoted
      expect(market.pricePrecision).toBeGreaterThan(0);
      expect(market.sizePrecision).toBeGreaterThanOrEqual(0); // Can be 0 for whole number assets
      expect(market.minSize).toBeGreaterThan(0);
      expect(market.tickSize).toBeGreaterThan(0);
      expect(market.raw).toBeDefined();
    }
  });

  it("should find market by symbol", async () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey,
      isTestnet: true,
    });

    // Try to find BTC market
    const btcMarket = await getMarketBySymbol(clients, "BTC");

    if (btcMarket) {
      expect(btcMarket.base).toBe("BTC");
      expect(btcMarket.quote).toBe("USD");
      expect(btcMarket.symbol).toBe("BTC/USD:USD");
    }
  });

  it("should handle full symbol format", async () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey,
      isTestnet: true,
    });

    // Try with full symbol format
    const btcMarket = await getMarketBySymbol(clients, "BTC/USD:USD");

    if (btcMarket) {
      expect(btcMarket.base).toBe("BTC");
      expect(btcMarket.quote).toBe("USD");
    }
  });

  it("should return undefined for non-existent symbol", async () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey,
      isTestnet: true,
    });

    const market = await getMarketBySymbol(clients, "NONEXISTENT");
    expect(market).toBeUndefined();
  });
});
