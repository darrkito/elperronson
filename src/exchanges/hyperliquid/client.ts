import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../../utils/logger.js";

export interface HyperliquidClientConfig {
  privateKey: string;
  isTestnet?: boolean;
}

export interface HyperliquidClients {
  transport: HttpTransport;
  info: InfoClient;
  exchange: ExchangeClient;
  wallet: Account;
}

/**
 * Initialize Hyperliquid SDK clients (HttpTransport, InfoClient, ExchangeClient)
 * Configurable for mainnet/testnet via isTestnet parameter
 */
export function createHyperliquidClient(config: HyperliquidClientConfig): HyperliquidClients {
  const { privateKey, isTestnet = false } = config;

  // Validate private key format
  if (!privateKey) {
    throw new Error("HL_PRIVATE_KEY is required");
  }

  // Ensure private key has 0x prefix
  const formattedPrivateKey = privateKey.startsWith("0x")
    ? (privateKey as `0x${string}`)
    : (`0x${privateKey}` as `0x${string}`);

  // Create wallet from private key using viem
  const wallet = privateKeyToAccount(formattedPrivateKey);
  logger.info(
    `Initialized Hyperliquid wallet: ${wallet.address} (${isTestnet ? "testnet" : "mainnet"})`
  );

  // Initialize HTTP transport with testnet configuration
  const transport = new HttpTransport({ isTestnet });

  // Initialize InfoClient for read-only operations
  const info = new InfoClient({ transport });

  // Initialize ExchangeClient for trading operations
  const exchange = new ExchangeClient({
    transport,
    wallet,
  });

  return {
    transport,
    info,
    exchange,
    wallet,
  };
}

/**
 * Create Hyperliquid clients from environment variables
 */
export function createHyperliquidClientFromEnv(): HyperliquidClients {
  const privateKey = process.env.HL_PRIVATE_KEY;
  const isTestnet = process.env.HL_TESTNET === "true";

  if (!privateKey) {
    throw new Error("HL_PRIVATE_KEY environment variable is required for Hyperliquid");
  }

  return createHyperliquidClient({ privateKey, isTestnet });
}
