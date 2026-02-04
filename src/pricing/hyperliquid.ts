import { type L2BookWsEvent, SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import type { ISubscription } from "@nktkas/hyperliquid";
import { logger } from "../utils/logger.js";

export type PriceCallback = (price: number, timestamp: number) => void;

/**
 * Hyperliquid WebSocket price feed
 * Streams real-time mid prices from Hyperliquid perpetuals
 * Used as price oracle for market making on other exchanges
 */
export class HyperliquidPriceFeed {
  private transport: WebSocketTransport | null = null;
  private client: SubscriptionClient | null = null;
  private subscription: ISubscription | null = null;
  private symbol: string;
  private callback: PriceCallback;
  private isTestnet: boolean;
  private shouldReconnect = true;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private lastPrice: number | null = null;
  private lastTimestamp: number | null = null;

  /**
   * Create a Hyperliquid price feed
   * @param symbol - Trading symbol (e.g., "BTC", "ETH", "DOGE")
   * @param callback - Called on each price update with mid price
   * @param isTestnet - Use testnet (default: false)
   */
  constructor(symbol: string, callback: PriceCallback, isTestnet = false) {
    // Hyperliquid uses uppercase symbols directly
    this.symbol = symbol.toUpperCase();
    this.callback = callback;
    this.isTestnet = isTestnet;
  }

  /**
   * Connect to Hyperliquid WebSocket
   */
  async connect(): Promise<void> {
    if (this.transport) {
      return;
    }

    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        logger.info(
          `Connecting to Hyperliquid price feed for ${this.symbol} (${this.isTestnet ? "testnet" : "mainnet"})`
        );

        // Initialize WebSocket transport
        this.transport = new WebSocketTransport({
          isTestnet: this.isTestnet,
          resubscribe: true,
        });

        // Initialize subscription client
        this.client = new SubscriptionClient({
          transport: this.transport,
        });

        // Subscribe to L2 book
        this.client
          .l2Book({ coin: this.symbol }, (data: L2BookWsEvent) => {
            this.handleL2BookUpdate(data);
          })
          .then((sub) => {
            this.subscription = sub;

            // Monitor subscription failure
            sub.failureSignal.addEventListener("abort", () => {
              logger.error(`Hyperliquid subscription failed for ${this.symbol}`);
              this.handleDisconnect();
            });

            logger.info(`Hyperliquid price feed connected for ${this.symbol}`);

            // Clear any pending reconnect
            if (this.reconnectTimeout) {
              clearTimeout(this.reconnectTimeout);
              this.reconnectTimeout = null;
            }

            resolve();
          })
          .catch((error) => {
            logger.error("Failed to subscribe to Hyperliquid L2 book:", error);
            reject(error);
          });
      } catch (error) {
        logger.error("Failed to connect to Hyperliquid:", error);
        reject(error);
      }
    });
  }

  /**
   * Handle L2 book update - calculate mid price
   */
  private handleL2BookUpdate(data: L2BookWsEvent): void {
    try {
      // data.levels[0] = bids, data.levels[1] = asks
      const bestBid = data.levels[0][0];
      const bestAsk = data.levels[1][0];

      if (!bestBid || !bestAsk) {
        logger.debug(`No bid/ask for ${this.symbol}`);
        return;
      }

      const bidPrice = Number.parseFloat(bestBid.px);
      const askPrice = Number.parseFloat(bestAsk.px);

      // Calculate mid price
      const midPrice = (bidPrice + askPrice) / 2;
      const timestamp = data.time;

      this.lastPrice = midPrice;
      this.lastTimestamp = timestamp;

      // Emit price update
      this.callback(midPrice, timestamp);
    } catch (error) {
      logger.error("Error processing Hyperliquid L2 book update:", error);
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(): void {
    this.subscription = null;

    if (this.shouldReconnect && !this.reconnectTimeout) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    logger.info("Scheduling Hyperliquid reconnection in 5 seconds...");
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;

      // Clean up old transport
      this.transport = null;
      this.client = null;

      this.connect().catch((error) => {
        logger.error("Hyperliquid reconnection failed:", error);
        this.scheduleReconnect();
      });
    }, 5000);
  }

  /**
   * Disconnect from Hyperliquid WebSocket
   */
  async disconnect(): Promise<void> {
    logger.info("Disconnecting from Hyperliquid price feed");
    this.shouldReconnect = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.subscription) {
      try {
        await this.subscription.unsubscribe();
      } catch (error) {
        logger.error("Error unsubscribing from Hyperliquid:", error);
      }
      this.subscription = null;
    }

    this.transport = null;
    this.client = null;
  }

  /**
   * Get the last received mid price
   */
  getLastPrice(): number | null {
    return this.lastPrice;
  }

  /**
   * Get the last price timestamp
   */
  getLastTimestamp(): number | null {
    return this.lastTimestamp;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return (
      this.transport !== null && this.transport.socket.readyState === this.transport.socket.OPEN
    );
  }
}

/**
 * Create a Hyperliquid price feed and connect
 * @param symbol - Trading symbol
 * @param callback - Price callback
 * @param isTestnet - Use testnet
 */
export async function createHyperliquidPriceFeed(
  symbol: string,
  callback: PriceCallback,
  isTestnet = false
): Promise<HyperliquidPriceFeed> {
  const feed = new HyperliquidPriceFeed(symbol, callback, isTestnet);
  await feed.connect();
  return feed;
}
