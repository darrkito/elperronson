import EventSource from "eventsource";
import type { Orderbook } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { AftermathClient } from "./client.js";

/**
 * Aftermath CCXT Orderbook Response
 */
interface AftermathOrderbook {
  bids: [number, number][]; // [price, amount]
  asks: [number, number][]; // [price, amount]
  symbol?: string;
  timestamp?: number;
  datetime?: string;
  nonce?: number;
}

/**
 * Aftermath Orderbook Delta (from SSE stream)
 */
interface AftermathOrderbookDelta {
  bids: [number, number][]; // [price, amountDelta]
  asks: [number, number][]; // [price, amountDelta]
  symbol?: string;
  timestamp: number;
  datetime?: string;
  nonce: number;
}

/**
 * Fetch orderbook snapshot from Aftermath
 * @param client - Aftermath API client
 * @param chId - Market/ClearingHouse ID
 */
export async function getOrderbook(client: AftermathClient, chId: string): Promise<Orderbook> {
  logger.debug(`Fetching orderbook for market ${chId}`);

  const response = await client.post<AftermathOrderbook>("/api/ccxt/orderbook", { chId });

  return {
    symbol: response.symbol || chId,
    bids: response.bids,
    asks: response.asks,
    timestamp: response.timestamp || Date.now(),
    nonce: response.nonce,
  };
}

/**
 * Manages orderbook subscription via Server-Sent Events
 */
export class AftermathOrderbookSubscription {
  private baseUrl: string;
  private eventSources: Map<string, EventSource> = new Map();
  private localOrderbooks: Map<string, Orderbook> = new Map();
  private callbacks: Map<string, (book: Orderbook) => void> = new Map();
  private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private client: AftermathClient;

  constructor(client: AftermathClient, baseUrl?: string) {
    this.client = client;
    this.baseUrl = baseUrl || client.getBaseUrl();
  }

  /**
   * Subscribe to orderbook updates for a market
   * @param chId - Market/ClearingHouse ID
   * @param callback - Called on each orderbook update
   */
  async subscribeOrderbook(chId: string, callback: (book: Orderbook) => void): Promise<void> {
    // If already subscribed, just update callback
    if (this.eventSources.has(chId)) {
      this.callbacks.set(chId, callback);
      return;
    }

    logger.info(`Subscribing to Aftermath orderbook for market ${chId}`);

    // Fetch initial snapshot
    try {
      const snapshot = await getOrderbook(this.client, chId);
      this.localOrderbooks.set(chId, snapshot);
      callback(snapshot);
    } catch (error) {
      logger.error(`Failed to fetch initial orderbook for ${chId}:`, error);
      throw error;
    }

    // Store callback
    this.callbacks.set(chId, callback);

    // Connect to SSE stream
    this.connectSSE(chId);
  }

  /**
   * Connect to SSE stream for orderbook updates
   */
  private connectSSE(chId: string): void {
    const url = `${this.baseUrl}/api/ccxt/stream/orderbook?chId=${encodeURIComponent(chId)}`;
    logger.debug(`Connecting to SSE: ${url}`);

    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      logger.info(`SSE connected for orderbook ${chId}`);
      // Clear any pending reconnect
      const timeout = this.reconnectTimeouts.get(chId);
      if (timeout) {
        clearTimeout(timeout);
        this.reconnectTimeouts.delete(chId);
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const delta = JSON.parse(event.data) as AftermathOrderbookDelta;
        this.applyDelta(chId, delta);
      } catch (error) {
        logger.error(`Failed to parse orderbook delta for ${chId}:`, error);
      }
    };

    eventSource.onerror = (error) => {
      logger.error(`SSE error for orderbook ${chId}:`, error);

      // Close the errored connection
      eventSource.close();
      this.eventSources.delete(chId);

      // Schedule reconnection
      if (this.callbacks.has(chId)) {
        const timeout = setTimeout(() => {
          logger.info(`Reconnecting SSE for orderbook ${chId}...`);
          this.connectSSE(chId);
        }, 5000);
        this.reconnectTimeouts.set(chId, timeout);
      }
    };

    this.eventSources.set(chId, eventSource);
  }

  /**
   * Apply delta updates to local orderbook
   */
  private applyDelta(chId: string, delta: AftermathOrderbookDelta): void {
    const book = this.localOrderbooks.get(chId);
    if (!book) {
      logger.warn(`No local orderbook for ${chId}, ignoring delta`);
      return;
    }

    // Check nonce for ordering (skip if out of order)
    if (book.nonce !== undefined && delta.nonce <= book.nonce) {
      logger.debug(`Skipping out-of-order delta for ${chId}: ${delta.nonce} <= ${book.nonce}`);
      return;
    }

    // Apply bid deltas
    for (const [price, amountDelta] of delta.bids) {
      this.applyPriceLevelDelta(book.bids, price, amountDelta, true);
    }

    // Apply ask deltas
    for (const [price, amountDelta] of delta.asks) {
      this.applyPriceLevelDelta(book.asks, price, amountDelta, false);
    }

    // Update metadata
    book.timestamp = delta.timestamp;
    book.nonce = delta.nonce;

    // Notify callback
    const callback = this.callbacks.get(chId);
    if (callback) {
      callback(book);
    }
  }

  /**
   * Apply a single price level delta
   * @param levels - Bid or ask array
   * @param price - Price level
   * @param amountDelta - Amount change (positive to add, negative to remove)
   * @param isBid - True for bids (descending), false for asks (ascending)
   */
  private applyPriceLevelDelta(
    levels: [number, number][],
    price: number,
    amountDelta: number,
    isBid: boolean
  ): void {
    // Find existing level
    const existingIndex = levels.findIndex(([p]) => p === price);

    if (existingIndex >= 0) {
      // Update existing level
      const newAmount = levels[existingIndex][1] + amountDelta;
      if (newAmount <= 0) {
        // Remove level if amount is zero or negative
        levels.splice(existingIndex, 1);
      } else {
        levels[existingIndex][1] = newAmount;
      }
    } else if (amountDelta > 0) {
      // Insert new level at correct position
      const insertIndex = levels.findIndex(([p]) => (isBid ? p < price : p > price));
      if (insertIndex >= 0) {
        levels.splice(insertIndex, 0, [price, amountDelta]);
      } else {
        levels.push([price, amountDelta]);
      }
    }
  }

  /**
   * Unsubscribe from orderbook updates
   * @param chId - Market/ClearingHouse ID
   */
  async unsubscribeOrderbook(chId: string): Promise<void> {
    logger.info(`Unsubscribing from Aftermath orderbook for market ${chId}`);

    // Close SSE connection
    const eventSource = this.eventSources.get(chId);
    if (eventSource) {
      eventSource.close();
      this.eventSources.delete(chId);
    }

    // Clear reconnect timeout
    const timeout = this.reconnectTimeouts.get(chId);
    if (timeout) {
      clearTimeout(timeout);
      this.reconnectTimeouts.delete(chId);
    }

    // Remove local data
    this.localOrderbooks.delete(chId);
    this.callbacks.delete(chId);
  }

  /**
   * Get the current local orderbook for a market
   */
  getLocalOrderbook(chId: string): Orderbook | undefined {
    return this.localOrderbooks.get(chId);
  }

  /**
   * Disconnect all subscriptions
   */
  async disconnect(): Promise<void> {
    logger.info("Disconnecting all Aftermath orderbook subscriptions");

    for (const [chId, eventSource] of this.eventSources) {
      eventSource.close();
      const timeout = this.reconnectTimeouts.get(chId);
      if (timeout) {
        clearTimeout(timeout);
      }
    }

    this.eventSources.clear();
    this.reconnectTimeouts.clear();
    this.localOrderbooks.clear();
    this.callbacks.clear();
  }

  /**
   * Check if connected to any subscriptions
   */
  get connected(): boolean {
    return this.eventSources.size > 0;
  }
}
