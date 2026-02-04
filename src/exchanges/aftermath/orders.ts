import type { Order, OrderRequest, OrderResult, OrderStatus } from "../../types.js";
import { logger } from "../../utils/logger.js";
import { getAccountCap } from "./account.js";
import type { AftermathClient } from "./client.js";
import type { SuiSigner } from "./signer.js";

/**
 * Transaction build response from Aftermath
 */
interface TransactionBuildResponse {
  transactionBytes: string; // Base64 BCS-encoded transaction
  signingDigest: string; // Base64 32-byte digest to sign
}

/**
 * Transaction metadata for build requests
 */
interface TransactionMetadata {
  sender: string;
  gasBudget?: number;
  gasPrice?: number;
}

/**
 * Order request for Aftermath API
 */
interface AftermathOrderRequest {
  chId: string;
  type: "market" | "limit";
  side: "buy" | "sell";
  amount?: number;
  price?: number;
  reduceOnly?: boolean;
  expirationTimestampMs?: number;
}

/**
 * Aftermath Order Response
 */
interface AftermathOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type?: "market" | "limit";
  status: "open" | "closed" | "canceled" | "expired" | "rejected";
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  cost: number;
  timestamp: number;
  datetime?: string;
  trades?: unknown[];
  fee?: {
    cost: number;
    currency: string;
  };
  timeInForce?: string;
  reduceOnly?: boolean;
  clientOrderId?: string;
}

/**
 * Build and submit a transaction
 * @param client - Aftermath API client
 * @param signer - Sui signer for transaction signing
 * @param buildEndpoint - Build endpoint (e.g., "/api/ccxt/build/createOrders")
 * @param submitEndpoint - Submit endpoint (e.g., "/api/ccxt/submit/createOrders")
 * @param buildBody - Request body for build endpoint
 */
async function buildAndSubmit<T>(
  client: AftermathClient,
  signer: SuiSigner,
  buildEndpoint: string,
  submitEndpoint: string,
  buildBody: unknown
): Promise<T> {
  logger.debug(`Building transaction: ${buildEndpoint}`);

  // Step 1: Build transaction
  const buildResponse = await client.post<TransactionBuildResponse>(buildEndpoint, buildBody);

  logger.debug(`Transaction built, signingDigest: ${buildResponse.signingDigest}`);

  // Step 2: Sign the transaction digest
  // The signingDigest is Base64-encoded, decode it for signing
  const digestBytes = Buffer.from(buildResponse.signingDigest, "base64");
  const signature = await signer.signTransaction(digestBytes);

  // Construct the full Sui signature (flag byte + signature + public key)
  // Ed25519 flag = 0x00
  const signatureBytes = Buffer.from(signature, "base64");
  const publicKeyBytes = signer.getPublicKeyBytes();
  const fullSignature = Buffer.concat([
    Buffer.from([0x00]), // Ed25519 scheme flag
    signatureBytes,
    publicKeyBytes,
  ]);
  const fullSignatureBase64 = fullSignature.toString("base64");

  logger.debug("Transaction signed, submitting...");

  // Step 3: Submit signed transaction
  const submitResponse = await client.post<T>(submitEndpoint, {
    transactionBytes: buildResponse.transactionBytes,
    signatures: [fullSignatureBase64],
  });

  logger.debug("Transaction submitted successfully");
  return submitResponse;
}

/**
 * Place an order on Aftermath
 * @param client - Aftermath API client
 * @param signer - Sui signer
 * @param walletAddress - Wallet address
 * @param chId - Market/ClearingHouse ID
 * @param order - Order parameters
 */
export async function placeOrder(
  client: AftermathClient,
  signer: SuiSigner,
  walletAddress: string,
  chId: string,
  order: OrderRequest
): Promise<OrderResult> {
  logger.info(`Placing ${order.side} ${order.type} order: ${order.size} @ ${order.price}`);

  // Get account capability
  const { accountCapId } = await getAccountCap(client, walletAddress);

  // Build order request
  const orderReq: AftermathOrderRequest = {
    chId,
    type: order.type,
    side: order.side,
    amount: order.size,
    price: order.price,
    reduceOnly: order.reduceOnly,
  };

  // Build metadata
  const metadata: TransactionMetadata = {
    sender: walletAddress,
  };

  // Build and submit
  const orders = await buildAndSubmit<AftermathOrder[]>(
    client,
    signer,
    "/api/ccxt/build/createOrders",
    "/api/ccxt/submit/createOrders",
    {
      accountId: accountCapId,
      orders: [orderReq],
      deallocateFreeCollateral: false,
      metadata,
    }
  );

  if (!orders || orders.length === 0) {
    throw new Error("No order returned from Aftermath");
  }

  const resultOrder = orders[0];
  logger.info(`Order placed successfully: ${resultOrder.id}`);

  return {
    orderId: resultOrder.id,
    clientId: order.clientId,
    status: resultOrder.status as OrderStatus,
    timestamp: resultOrder.timestamp || Date.now(),
    raw: resultOrder,
  };
}

/**
 * Cancel orders on Aftermath
 * @param client - Aftermath API client
 * @param signer - Sui signer
 * @param walletAddress - Wallet address
 * @param chId - Market/ClearingHouse ID
 * @param orderIds - Order IDs to cancel
 */
export async function cancelOrders(
  client: AftermathClient,
  signer: SuiSigner,
  walletAddress: string,
  chId: string,
  orderIds: string[]
): Promise<AftermathOrder[]> {
  if (orderIds.length === 0) {
    logger.debug("No orders to cancel");
    return [];
  }

  logger.info(`Canceling ${orderIds.length} orders in market ${chId}`);

  // Get account capability
  const { accountCapId } = await getAccountCap(client, walletAddress);

  // Build metadata
  const metadata: TransactionMetadata = {
    sender: walletAddress,
  };

  // Build and submit
  const canceledOrders = await buildAndSubmit<AftermathOrder[]>(
    client,
    signer,
    "/api/ccxt/build/cancelOrders",
    "/api/ccxt/submit/cancelOrders",
    {
      accountId: accountCapId,
      chId,
      orderIds,
      deallocateFreeCollateral: false,
      metadata,
    }
  );

  logger.info(`Canceled ${canceledOrders.length} orders`);
  return canceledOrders;
}

/**
 * Cancel a single order
 */
export async function cancelOrder(
  client: AftermathClient,
  signer: SuiSigner,
  walletAddress: string,
  chId: string,
  orderId: string
): Promise<void> {
  await cancelOrders(client, signer, walletAddress, chId, [orderId]);
}

/**
 * Get pending orders for an account in a market
 * @param client - Aftermath API client
 * @param accountNumber - Account number
 * @param chId - Market/ClearingHouse ID
 */
export async function getOpenOrders(
  client: AftermathClient,
  accountNumber: number,
  chId: string
): Promise<Order[]> {
  logger.debug(`Fetching pending orders for account ${accountNumber} in market ${chId}`);

  const orders = await client.post<AftermathOrder[]>("/api/ccxt/myPendingOrders", {
    accountNumber,
    chId,
  });

  return orders.map((o) => ({
    id: o.id,
    clientId: o.clientOrderId,
    symbol: o.symbol,
    type: o.type || "limit",
    side: o.side,
    price: o.price,
    size: o.amount,
    filled: o.filled,
    remaining: o.remaining,
    status: o.status as OrderStatus,
    timestamp: o.timestamp,
    reduceOnly: o.reduceOnly,
    raw: o,
  }));
}

/**
 * Get all open orders across all markets
 * @param client - Aftermath API client
 * @param walletAddress - Wallet address
 * @param markets - List of market chIds to check
 */
export async function getAllOpenOrders(
  client: AftermathClient,
  walletAddress: string,
  markets: string[]
): Promise<Order[]> {
  const { accountNumber } = await getAccountCap(client, walletAddress);

  const allOrders: Order[] = [];

  for (const chId of markets) {
    try {
      const orders = await getOpenOrders(client, accountNumber, chId);
      allOrders.push(...orders);
    } catch (error) {
      logger.warn(`Failed to fetch orders for market ${chId}:`, error);
    }
  }

  return allOrders;
}
