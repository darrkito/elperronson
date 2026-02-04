import { logger } from "../utils/logger.js";
import { createAftermathAdapterFromEnv } from "./aftermath/index.js";
import { createHyperliquidAdapterFromEnv } from "./hyperliquid/index.js";
import type { IExchange } from "./types.js";

export type ExchangeName = "aftermath" | "hyperliquid";

/**
 * Create an exchange adapter by name
 * @param name - Exchange name ("aftermath" or "hyperliquid")
 * @returns Exchange adapter implementing IExchange
 */
export function createExchange(name: ExchangeName): IExchange {
  logger.info(`Creating exchange adapter for: ${name}`);

  switch (name.toLowerCase()) {
    case "aftermath":
      return createAftermathAdapterFromEnv();

    case "hyperliquid":
      return createHyperliquidAdapterFromEnv();

    default:
      throw new Error(`Unknown exchange: ${name}. Supported: aftermath, hyperliquid`);
  }
}

/**
 * Get list of supported exchange names
 */
export function getSupportedExchanges(): ExchangeName[] {
  return ["aftermath", "hyperliquid"];
}

// Re-export types and adapters
export type { IExchange } from "./types.js";
export type { AftermathAdapter } from "./aftermath/index.js";
export type { HyperliquidAdapter } from "./hyperliquid/index.js";
