import { describe, expect, it } from "vitest";
import { createHyperliquidClient } from "../src/exchanges/hyperliquid/client.js";

describe("Hyperliquid Client Setup", () => {
  // Test private key (example, not a real one)
  const testPrivateKey = "0x0000000000000000000000000000000000000000000000000000000000000001";

  it("should create clients with valid configuration", () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey,
      isTestnet: true,
    });

    expect(clients.transport).toBeDefined();
    expect(clients.info).toBeDefined();
    expect(clients.exchange).toBeDefined();
    expect(clients.wallet).toBeDefined();
    expect(clients.wallet.address).toBeDefined();
    expect(clients.transport.isTestnet).toBe(true);
  });

  it("should create mainnet clients by default", () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey,
    });

    expect(clients.transport.isTestnet).toBe(false);
  });

  it("should handle private key with 0x prefix", () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey,
      isTestnet: true,
    });

    expect(clients.wallet.address).toBeDefined();
  });

  it("should handle private key without 0x prefix", () => {
    const clients = createHyperliquidClient({
      privateKey: testPrivateKey.slice(2), // Remove 0x prefix
      isTestnet: true,
    });

    expect(clients.wallet.address).toBeDefined();
  });

  it("should throw error for missing private key", () => {
    expect(() =>
      createHyperliquidClient({
        privateKey: "",
        isTestnet: true,
      })
    ).toThrow("HL_PRIVATE_KEY is required");
  });
});
