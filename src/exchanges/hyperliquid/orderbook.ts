import { type L2BookWsEvent, SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import type { ISubscription } from "@nktkas/hyperliquid";
import type { Orderbook } from "../../types.js";
import { logger } from "../../utils/logger.js";

export interface OrderbookSubscriptionConfig {
  isTestnet?: boolean;
}

/**
 * Hyperliquid orderbook subscription manager
 * Handles WebSocket L2 orderbook subscriptions with automatic reconnection
 */
export class HyperliquidOrderbookSubscription {
  private transport: WebSocketTransport;
  private client: SubscriptionClient;
  private subscriptions: Map<string, ISubscription>;

  constructor(config: OrderbookSubscriptionConfig = {}) {
    const { isTestnet = false } = config;

    // Initialize WebSocket transport with automatic reconnection
    this.transport = new WebSocketTransport({
      isTestnet,
      resubscribe: true, // Automatically resubscribe after reconnection
    });

    // Initialize subscription client
    this.client = new SubscriptionClient({
      transport: this.transport,
    });

    this.subscriptions = new Map();

    logger.info(
      `Initialized Hyperliquid orderbook subscription (${isTestnet ? "testnet" : "mainnet"})`
    );
  }

  /**
   * Subscribe to orderbook updates for a symbol
   * @param symbol - Trading symbol (e.g., "BTC")
   * @param callback - Called on each orderbook update
   */
  async subscribeOrderbook(symbol: string, callback: (book: Orderbook) => void): Promise<void> {
    // Check if already subscribed
    if (this.subscriptions.has(symbol)) {
      logger.warn(`Already subscribed to orderbook: ${symbol}`);
      return;
    }

    try {
      // Subscribe to L2 orderbook for the symbol
      const subscription = await this.client.l2Book({ coin: symbol }, (data: L2BookWsEvent) => {
        try {
          // Convert Hyperliquid L2 book to common Orderbook type
          const orderbook = this.convertToOrderbook(symbol, data);
          callback(orderbook);
        } catch (error) {
          logger.error(`Error processing orderbook update for ${symbol}`, error);
        }
      });

      // Store subscription for unsubscribe
      this.subscriptions.set(symbol, subscription);

      // Monitor subscription failure
      subscription.failureSignal.addEventListener("abort", () => {
        logger.error(`Subscription failed for ${symbol}, removing from active subscriptions`);
        this.subscriptions.delete(symbol);
      });

      logger.info(`Subscribed to orderbook: ${symbol}`);
    } catch (error) {
      logger.error(`Failed to subscribe to orderbook for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe from orderbook updates for a symbol
   * @param symbol - Trading symbol
   */
  async unsubscribeOrderbook(symbol: string): Promise<void> {
    const subscription = this.subscriptions.get(symbol);

    if (!subscription) {
      logger.warn(`Not subscribed to orderbook: ${symbol}`);
      return;
    }

    try {
      // Unsubscribe from L2 book
      await subscription.unsubscribe();

      // Remove from subscriptions map
      this.subscriptions.delete(symbol);

      logger.info(`Unsubscribed from orderbook: ${symbol}`);
    } catch (error) {
      logger.error(`Failed to unsubscribe from orderbook for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Convert Hyperliquid L2 book data to common Orderbook type
   */
  private convertToOrderbook(symbol: string, data: L2BookWsEvent): Orderbook {
    // Hyperliquid L2 book format:
    // {
    //   coin: string,
    //   time: number,
    //   levels: [[{ px: string, sz: string, n: number }], [{ px: string, sz: string, n: number }]]
    // }
    // levels[0] = bids (descending), levels[1] = asks (ascending)

    const bids: [number, number][] = data.levels[0].map((level) => [
      Number.parseFloat(level.px),
      Number.parseFloat(level.sz),
    ]);

    const asks: [number, number][] = data.levels[1].map((level) => [
      Number.parseFloat(level.px),
      Number.parseFloat(level.sz),
    ]);

    return {
      symbol,
      bids,
      asks,
      timestamp: data.time,
    };
  }

  /**
   * Disconnect and cleanup resources
   */
  async disconnect(): Promise<void> {
    // Unsubscribe from all active subscriptions
    const unsubscribePromises = Array.from(this.subscriptions.entries()).map(
      async ([symbol, subscription]) => {
        try {
          await subscription.unsubscribe();
          logger.debug(`Unsubscribed from orderbook: ${symbol}`);
        } catch (error) {
          logger.error(`Error unsubscribing from ${symbol}`, error);
        }
      }
    );

    await Promise.all(unsubscribePromises);

    // Clear subscriptions
    this.subscriptions.clear();

    logger.info("Hyperliquid orderbook subscription disconnected");
  }

  /**
   * Check if WebSocket is connected
   */
  get connected(): boolean {
    return this.transport.socket.readyState === this.transport.socket.OPEN;
  }
}

/**
 * Create orderbook subscription from environment variables
 */
export function createOrderbookSubscriptionFromEnv(): HyperliquidOrderbookSubscription {
  const isTestnet = process.env.HL_TESTNET === "true";
  return new HyperliquidOrderbookSubscription({ isTestnet });
}
