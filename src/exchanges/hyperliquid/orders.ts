import type { Order, OrderRequest, OrderResult } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { HyperliquidClients } from "./client.js";
import { getMarkets } from "./markets.js";

/**
 * Place a limit order on Hyperliquid
 * Supports reduce-only and post-only flags
 */
export async function placeOrder(
  clients: HyperliquidClients,
  order: OrderRequest
): Promise<OrderResult> {
  try {
    // Get market information to find asset index
    const markets = await getMarkets(clients);
    const market = markets.find(
      (m) => m.symbol === order.symbol || m.base === order.symbol.split("/")[0]
    );

    if (!market) {
      throw new Error(`Market not found for symbol: ${order.symbol}`);
    }

    const assetId = Number.parseInt(market.id, 10);

    // Determine time-in-force based on postOnly flag
    // "Alo" = Add Liquidity Only (post-only maker orders)
    // "Gtc" = Good Till Cancel (standard limit order)
    const tif: "Alo" | "Gtc" = order.postOnly ? "Alo" : "Gtc";

    // Prepare order parameters for Hyperliquid
    const orderParams = {
      orders: [
        {
          a: assetId, // Asset ID
          b: order.side === "buy", // Position side (true for long/buy, false for short/sell)
          p: order.price.toString(), // Price as string
          s: order.size.toString(), // Size as string
          r: order.reduceOnly ?? false, // Reduce-only flag
          t: { limit: { tif } } as const, // Order type (limit with time-in-force)
          c: order.clientId as `0x${string}` | undefined, // Client Order ID (optional)
        },
      ],
      grouping: "na" as const, // No grouping for regular orders
    };

    logger.debug(
      `Placing Hyperliquid order: ${order.side} ${order.size} ${order.symbol} @ ${order.price}`
    );

    // Place the order via ExchangeClient
    const response = await clients.exchange.order(orderParams);

    // Extract the status of the first (and only) order
    const status = response.response.data.statuses[0];

    // Handle different order status responses
    if (!status) {
      throw new Error("No order status in response");
    }

    // Handle string statuses
    if (typeof status === "string") {
      if (status === "waitingForFill") {
        throw new Error("Order status 'waitingForFill' - order ID not available yet");
      }
      if (status === "waitingForTrigger") {
        throw new Error("Order status 'waitingForTrigger' - unexpected for limit orders");
      }
      throw new Error(`Unknown order status: ${status}`);
    }

    // Handle error status
    if ("error" in status) {
      throw new Error(`Order rejected: ${status.error}`);
    }

    // Determine the order ID based on response type
    let orderId: number;
    let orderStatus: "open" | "closed";
    let clientId: string | undefined;

    if ("resting" in status) {
      // Order is resting on the book (open)
      orderId = status.resting.oid;
      clientId = status.resting.cloid;
      orderStatus = "open";
    } else if ("filled" in status) {
      // Order was immediately filled
      orderId = status.filled.oid;
      clientId = status.filled.cloid;
      orderStatus = "closed";
      logger.info(`Order immediately filled: ${status.filled.totalSz} @ ${status.filled.avgPx}`);
    } else {
      throw new Error(`Unknown order status: ${JSON.stringify(status)}`);
    }

    const result: OrderResult = {
      orderId: orderId.toString(),
      clientId,
      status: orderStatus,
      timestamp: Date.now(),
      raw: response,
    };

    logger.info(`Order placed successfully: ID=${result.orderId}, status=${result.status}`);

    return result;
  } catch (error) {
    logger.error("Failed to place Hyperliquid order", error);
    throw error;
  }
}

/**
 * Cancel an order by order ID
 */
export async function cancelOrder(
  clients: HyperliquidClients,
  orderId: string,
  symbol?: string
): Promise<void> {
  try {
    // Get market information to find asset index
    const markets = await getMarkets(clients);

    // If symbol is provided, find the specific market
    // Otherwise, we need to find which market this order belongs to
    // For simplicity, if no symbol provided, we'll need to fetch open orders to find it
    let assetId: number;

    if (symbol) {
      const market = markets.find((m) => m.symbol === symbol || m.base === symbol.split("/")[0]);
      if (!market) {
        throw new Error(`Market not found for symbol: ${symbol}`);
      }
      assetId = Number.parseInt(market.id, 10);
    } else {
      // Fetch open orders to find the asset ID for this order
      const openOrders = await getOpenOrders(clients);
      const order = openOrders.find((o) => o.id === orderId);

      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }

      const market = markets.find((m) => m.base === order.symbol.split("/")[0]);
      if (!market) {
        throw new Error(`Market not found for order: ${orderId}`);
      }
      assetId = Number.parseInt(market.id, 10);
    }

    const orderIdNum = Number.parseInt(orderId, 10);

    logger.debug(`Canceling Hyperliquid order: ${orderId} (asset ${assetId})`);

    // Cancel the order via ExchangeClient
    const response = await clients.exchange.cancel({
      cancels: [{ a: assetId, o: orderIdNum }],
    });

    // Check the cancellation status
    const cancelStatus = response.response.data.statuses[0];

    if (!cancelStatus) {
      throw new Error("No cancellation status in response");
    }

    if (cancelStatus !== "success") {
      const errorStatus = cancelStatus as { error: string };
      throw new Error(`Order cancellation failed: ${errorStatus.error}`);
    }

    logger.info(`Order canceled successfully: ${orderId}`);
  } catch (error) {
    logger.error(`Failed to cancel Hyperliquid order: ${orderId}`, error);
    throw error;
  }
}

/**
 * Cancel all open orders, optionally filtered by symbol
 */
export async function cancelAllOrders(clients: HyperliquidClients, symbol?: string): Promise<void> {
  try {
    // Get all open orders
    const openOrders = await getOpenOrders(clients, symbol);

    if (openOrders.length === 0) {
      logger.info("No open orders to cancel");
      return;
    }

    logger.debug(`Canceling ${openOrders.length} open orders`);

    // Get markets to map symbols to asset IDs
    const markets = await getMarkets(clients);

    // Build cancel requests for all orders
    const cancels = openOrders.map((order) => {
      const market = markets.find((m) => m.base === order.symbol.split("/")[0]);
      if (!market) {
        throw new Error(`Market not found for symbol: ${order.symbol}`);
      }
      const assetId = Number.parseInt(market.id, 10);
      const orderIdNum = Number.parseInt(order.id, 10);

      return { a: assetId, o: orderIdNum };
    });

    // Cancel all orders in a single batch request
    const response = await clients.exchange.cancel({ cancels });

    // Check results
    let successCount = 0;
    let failCount = 0;

    response.response.data.statuses.forEach((cancelStatus, index) => {
      if (cancelStatus === "success") {
        successCount++;
      } else {
        const errorStatus = cancelStatus as { error: string };
        failCount++;
        logger.warn(`Failed to cancel order ${openOrders[index]?.id}: ${errorStatus.error}`);
      }
    });

    logger.info(`Canceled ${successCount} orders successfully, ${failCount} failed`);
  } catch (error) {
    logger.error("Failed to cancel all Hyperliquid orders", error);
    throw error;
  }
}

/**
 * Get all open orders, optionally filtered by symbol
 */
export async function getOpenOrders(
  clients: HyperliquidClients,
  symbol?: string
): Promise<Order[]> {
  try {
    logger.debug("Fetching open orders from Hyperliquid");

    // Fetch open orders from InfoClient
    const response = await clients.info.openOrders({ user: clients.wallet.address });

    // Get markets to map coin names to full symbols
    const markets = await getMarkets(clients);

    // Filter by symbol if provided
    let orders = response;
    if (symbol) {
      const base = symbol.split("/")[0] || symbol;
      orders = response.filter((o) => o.coin === base);
    }

    // Map to common Order type
    const mappedOrders: Order[] = orders.map((o) => {
      // Find the market for this coin
      const market = markets.find((m) => m.base === o.coin);
      const fullSymbol = market ? market.symbol : `${o.coin}/USD:USD`;

      // Calculate filled and remaining amounts
      const origSize = Number.parseFloat(o.origSz);
      const currentSize = Number.parseFloat(o.sz);
      const filled = origSize - currentSize;
      const remaining = currentSize;

      return {
        id: o.oid.toString(),
        clientId: o.cloid,
        symbol: fullSymbol,
        type: "limit", // Hyperliquid openOrders only returns limit orders
        side: o.side === "B" ? "buy" : "sell",
        price: Number.parseFloat(o.limitPx),
        size: origSize,
        filled,
        remaining,
        status: "open",
        timestamp: o.timestamp,
        reduceOnly: o.reduceOnly,
        postOnly: undefined, // Not available in response
        raw: o,
      };
    });

    logger.debug(`Fetched ${mappedOrders.length} open orders`);

    return mappedOrders;
  } catch (error) {
    logger.error("Failed to fetch Hyperliquid open orders", error);
    throw error;
  }
}
