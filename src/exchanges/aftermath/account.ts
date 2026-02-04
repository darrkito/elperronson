import type { Account, Position } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { AftermathClient } from "./client.js";

/**
 * Aftermath Account Response from /api/ccxt/accounts
 */
interface AftermathAccount {
  id: string; // Object ID on Sui
  type: "capability" | "account";
  accountNumber: number; // Unique numerical ID
  code?: string; // Currency code (e.g., "USDC")
  collateral?: number; // Unallocated collateral amount
}

/**
 * Aftermath Position Response from /api/ccxt/positions
 */
interface AftermathPosition {
  id?: string;
  symbol: string;
  side?: "long" | "short";
  contracts?: number;
  contractSize?: number;
  entryPrice?: number;
  markPrice?: number;
  notional?: number;
  leverage?: number;
  collateral?: number;
  initialMargin?: number;
  initialMarginPercentage?: number;
  maintenanceMargin?: number;
  maintenanceMarginPercentage?: number;
  marginRatio?: number;
  marginMode?: "cross" | "isolated";
  unrealizedPnl?: number;
  realizedPnl?: number;
  liquidationPrice?: number;
  timestamp?: number;
  datetime?: string;
}

/**
 * Aftermath Balance Response from /api/ccxt/balance
 */
interface AftermathBalance {
  balances: {
    [currencyCode: string]: {
      free?: number;
      used?: number;
      total?: number;
      debt?: number;
    };
  };
  timestamp?: number;
}

/**
 * Cache for account info
 */
interface AccountCache {
  accountCapId: string; // Capability ID for transactions
  accountId: string; // Account object ID
  accountNumber: number; // Numerical account ID
  walletAddress: string;
}

let accountCache: AccountCache | null = null;

/**
 * Fetch accounts for a wallet address
 * @param client - Aftermath API client
 * @param walletAddress - Sui wallet address
 */
export async function getAccounts(
  client: AftermathClient,
  walletAddress: string
): Promise<AftermathAccount[]> {
  logger.debug(`Fetching accounts for wallet ${walletAddress}`);

  const accounts = await client.post<AftermathAccount[]>("/api/ccxt/accounts", {
    address: walletAddress,
  });

  logger.info(`Found ${accounts.length} accounts for wallet ${walletAddress}`);
  return accounts;
}

/**
 * Get or discover the account capability for a wallet
 * Caches the result for subsequent calls
 */
export async function getAccountCap(
  client: AftermathClient,
  walletAddress: string
): Promise<AccountCache> {
  // Return cached if available and matches wallet
  if (accountCache && accountCache.walletAddress === walletAddress) {
    return accountCache;
  }

  const accounts = await getAccounts(client, walletAddress);

  // Find capability account
  const capability = accounts.find((a) => a.type === "capability");
  const account = accounts.find((a) => a.type === "account");

  if (!capability) {
    throw new Error(
      `No account capability found for wallet ${walletAddress}. Create an account first.`
    );
  }

  if (!account) {
    throw new Error(`No account found for wallet ${walletAddress}. Create an account first.`);
  }

  accountCache = {
    accountCapId: capability.id,
    accountId: account.id,
    accountNumber: capability.accountNumber,
    walletAddress,
  };

  logger.info(
    `Account discovered: capId=${capability.id}, accountNumber=${capability.accountNumber}`
  );
  return accountCache;
}

/**
 * Clear the account cache
 */
export function clearAccountCache(): void {
  accountCache = null;
  logger.debug("Account cache cleared");
}

/**
 * Fetch balance for an account
 * @param client - Aftermath API client
 * @param accountId - Account capability ID or account ID
 */
export async function getBalance(
  client: AftermathClient,
  accountId: string
): Promise<AftermathBalance> {
  logger.debug(`Fetching balance for account ${accountId}`);

  const balance = await client.post<AftermathBalance>("/api/ccxt/balance", {
    account: accountId,
  });

  return balance;
}

/**
 * Get unified Account object for a wallet
 * @param client - Aftermath API client
 * @param walletAddress - Sui wallet address
 */
export async function getAccount(client: AftermathClient, walletAddress: string): Promise<Account> {
  // Get account info
  const { accountCapId, accountNumber } = await getAccountCap(client, walletAddress);

  // Get balance
  const balanceResp = await getBalance(client, accountCapId);

  // Sum up balances (primarily USDC)
  let equity = 0;
  let availableMargin = 0;

  for (const [code, balance] of Object.entries(balanceResp.balances)) {
    equity += balance.total || 0;
    availableMargin += balance.free || 0;
    logger.debug(
      `Balance ${code}: total=${balance.total}, free=${balance.free}, used=${balance.used}`
    );
  }

  // Get positions to calculate margin used
  const positions = await getPositions(client, accountNumber);
  const marginUsed = positions.reduce((sum, p) => sum + (p.margin || 0), 0);

  return {
    address: walletAddress,
    equity,
    margin: marginUsed,
    availableMargin,
    raw: { accountCapId, accountNumber, balances: balanceResp.balances },
  };
}

/**
 * Fetch positions for an account
 * @param client - Aftermath API client
 * @param accountNumber - Numerical account ID
 */
export async function getPositions(
  client: AftermathClient,
  accountNumber: number
): Promise<Position[]> {
  logger.debug(`Fetching positions for account ${accountNumber}`);

  const positions = await client.post<AftermathPosition[]>("/api/ccxt/positions", {
    accountNumber,
  });

  return positions
    .filter((p) => p.contracts && p.contracts !== 0) // Only non-zero positions
    .map((p) => ({
      symbol: p.symbol,
      side: p.side || (p.contracts && p.contracts > 0 ? "long" : "short"),
      size: p.contracts || 0,
      entryPrice: p.entryPrice || 0,
      markPrice: p.markPrice,
      liquidationPrice: p.liquidationPrice,
      unrealizedPnl: p.unrealizedPnl || 0,
      realizedPnl: p.realizedPnl,
      leverage: p.leverage,
      margin: p.collateral || p.initialMargin,
      raw: p,
    }));
}

/**
 * Get positions using cached account info
 */
export async function getPositionsForWallet(
  client: AftermathClient,
  walletAddress: string
): Promise<Position[]> {
  const { accountNumber } = await getAccountCap(client, walletAddress);
  return getPositions(client, accountNumber);
}
