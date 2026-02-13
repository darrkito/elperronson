import WebSocket from "ws";
import { logger } from "../utils/logger.js";

// CAMBIO 1: Host de Futuros (HYPE no está en Spot global)
const BINANCE_FUTURES_WS_URL = "wss://fstream.binance.com/ws";

/**
 * Payload optimizado para Market Making (bookTicker)
 */
interface BinanceBookTicker {
  e: string; // Event type ("bookTicker")
  u: number; // order book updateId
  s: string; // Symbol
  b: string; // Best bid price <--- Lo que usaremos como Fair Price
  B: string; // Best bid qty
  a: string; // Best ask price <--- Lo que usaremos como Fair Price
  A: string; // Best ask qty
  T: number; // Transaction time
  E: number; // Event time
}

export type PriceCallback = (price: number, timestamp: number) => void;

export class BinancePriceFeed {
  private ws: WebSocket | null = null;
  private symbol: string;
  private callback: PriceCallback;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private lastPrice: number | null = null;

  constructor(symbol: string, callback: PriceCallback) {
    this.symbol = this.normalizeSymbol(symbol);
    this.callback = callback;
  }

  private normalizeSymbol(symbol: string): string {
    // Para futuros, Binance siempre usa "hypeusdt" en minúsculas
    return `${symbol.split("/")[0].toLowerCase().replace("usd", "")}usdt`;
  }

  async connect(): Promise<void> {
    if (this.ws || this.isConnecting) return;

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      // CAMBIO 2: Usar @bookTicker para velocidad máxima
      const streamUrl = `${BINANCE_FUTURES_WS_URL}/${this.symbol}@bookTicker`;
      logger.info(`Connecting to Binance Futures: ${streamUrl}`);

      this.ws = new WebSocket(streamUrl);

      this.ws.on("open", () => {
        logger.info(`Binance Futures Feed ACTIVE: ${this.symbol}`);
        this.isConnecting = false;
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const ticker = JSON.parse(data.toString()) as BinanceBookTicker;
          
          // Calculamos el Mid Price (Precio medio entre compra y venta)
          // Esto es el Fair Price más preciso posible.
          const bid = Number.parseFloat(ticker.b);
          const ask = Number.parseFloat(ticker.a);
          const midPrice = (bid + ask) / 2;

          this.lastPrice = midPrice;
          this.callback(midPrice, ticker.T);
        } catch (error) {
          logger.error("Error parsing Binance ticker:", error);
        }
      });

      this.ws.on("close", () => {
        this.ws = null;
        this.isConnecting = false;
        if (this.shouldReconnect) this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        this.isConnecting = false;
        reject(err);
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
