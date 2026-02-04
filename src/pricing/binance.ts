import WebSocket from "ws";
import { logger } from "../utils/logger.js";

const BINANCE_WS_URL = "wss://stream.binance.com:9443/ws";

/**
 * Binance trade message from WebSocket
 */
interface BinanceTrade {
  e: string; // Event type ("trade")
  E: number; // Event time
  s: string; // Symbol
  t: number; // Trade ID
  p: string; // Price
  q: string; // Quantity
  b: number; // Buyer order ID
  a: number; // Seller order ID
  T: number; // Trade time
  m: boolean; // Is buyer maker
  M: boolean; // Ignore
}

export type PriceCallback = (price: number, timestamp: number) => void;

/**
 * Binance WebSocket price feed
 * Streams real-time trade prices from Binance spot market
 */
export class BinancePriceFeed {
  private ws: WebSocket | null = null;
  private symbol: string;
  private callback: PriceCallback;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private lastPrice: number | null = null;
  private lastTimestamp: number | null = null;

  /**
   * Create a Binance price feed
   * @param symbol - Trading symbol (e.g., "BTC" or "BTCUSDT")
   * @param callback - Called on each price update
   */
  constructor(symbol: string, callback: PriceCallback) {
    // Normalize symbol to Binance format (e.g., "BTC" -> "btcusdt")
    this.symbol = this.normalizeSymbol(symbol);
    this.callback = callback;
  }

  /**
   * Normalize symbol to Binance format
   */
  private normalizeSymbol(symbol: string): string {
    // Remove any suffix like /USD:USDC
    const base = symbol.split("/")[0].toLowerCase();
    // Add USDT suffix if not present
    if (!base.endsWith("usdt")) {
      return `${base}usdt`;
    }
    return base;
  }

  /**
   * Connect to Binance WebSocket
   */
  async connect(): Promise<void> {
    if (this.ws || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      const streamUrl = `${BINANCE_WS_URL}/${this.symbol}@trade`;
      logger.info(`Connecting to Binance price feed: ${streamUrl}`);

      this.ws = new WebSocket(streamUrl);

      this.ws.on("open", () => {
        logger.info(`Binance price feed connected for ${this.symbol}`);
        this.isConnecting = false;

        // Clear any pending reconnect
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const trade = JSON.parse(data.toString()) as BinanceTrade;
          const price = Number.parseFloat(trade.p);
          const timestamp = trade.T;

          this.lastPrice = price;
          this.lastTimestamp = timestamp;
          this.callback(price, timestamp);
        } catch (error) {
          logger.error("Failed to parse Binance trade:", error);
        }
      });

      this.ws.on("error", (error) => {
        logger.error("Binance WebSocket error:", error);
        this.isConnecting = false;
        reject(error);
      });

      this.ws.on("close", () => {
        logger.warn("Binance WebSocket closed");
        this.ws = null;
        this.isConnecting = false;

        // Reconnect if not intentionally disconnected
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    logger.info("Scheduling Binance reconnection in 5 seconds...");
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect().catch((error) => {
        logger.error("Binance reconnection failed:", error);
        this.scheduleReconnect();
      });
    }, 5000);
  }

  /**
   * Disconnect from Binance WebSocket
   */
  disconnect(): void {
    logger.info("Disconnecting from Binance price feed");
    this.shouldReconnect = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get the last received price
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
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Create a Binance price feed and connect
 * @param symbol - Trading symbol
 * @param callback - Price callback
 */
export async function createBinancePriceFeed(
  symbol: string,
  callback: PriceCallback
): Promise<BinancePriceFeed> {
  const feed = new BinancePriceFeed(symbol, callback);
  await feed.connect();
  return feed;
}
