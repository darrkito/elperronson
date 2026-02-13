import type { Market, OrderRequest, Side } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { MarketMakerConfig } from "./config.js";

/**
 * Quote with bid and ask prices
 */
export interface Quote {
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  fairPrice: number;
  spreadBps: number;
  isCloseMode: boolean;
}

/**
 * Quote generator for market making
 */
export class Quoter {
  private config: MarketMakerConfig;
  private market: Market | null = null;

  constructor(config: MarketMakerConfig) {
    this.config = config;
  }

  /**
   * Set the market for price rounding
   */
  setMarket(market: Market): void {
    this.market = market;
    logger.debug(`Quoter market set: ${market.symbol}, tickSize=${market.tickSize}`);
  }

  /**
   * Generate bid/ask quotes around fair price
   * @param fairPrice - Current fair price from Binance
   * @param positionNotional - Current position notional value (positive = long, negative = short)
   */
  generateQuotes(fairPrice: number, positionNotional: number): Quote {
    // Determine if we're in close mode
    const isCloseMode = Math.abs(positionNotional) > this.config.closeThresholdUsd;

    // Use tighter spread in close mode
    const spreadBps = isCloseMode ? this.config.takeProfitBps : this.config.spreadBps;

    // Calculate spread multiplier
    const spreadMultiplier = spreadBps / 10000;

    // Calculate bid and ask prices
    let bidPrice = fairPrice * (1 - spreadMultiplier);
    let askPrice = fairPrice * (1 + spreadMultiplier);

    // Round to tick size
    if (this.market) {
      bidPrice = this.roundToTick(bidPrice, "down");
      askPrice = this.roundToTick(askPrice, "up");
    }

    // Calculate order sizes
    const baseSize = this.config.orderSizeUsd / fairPrice;
    let bidSize = baseSize;
    let askSize = baseSize;

    // In close mode, only quote on the reducing side
    if (isCloseMode) {
      if (positionNotional > 0) {
        // Long position - only quote asks to reduce
        bidSize = 0;
        logger.debug("Close mode: long position, only asking");
      } else {
        // Short position - only quote bids to reduce
        askSize = 0;
        logger.debug("Close mode: short position, only bidding");
      }
    }

    // Round sizes to precision
    if (this.market) {
      bidSize = this.roundSize(bidSize);
      askSize = this.roundSize(askSize);
    }

    if (isCloseMode) {
      logger.info("!!! TAKE PROFIT ACTIVE !!! Quoting tight spread: ${spread}bps");
    }

    return {
      bidPrice,
      askPrice,
      bidSize,
      askSize,
      fairPrice,
      spreadBps,
      isCloseMode,
    };
  }

  /**
   * Convert quote to order requests
   */
  quoteToOrders(quote: Quote): OrderRequest[] {
    const orders: OrderRequest[] = [];

    // We ignore quote.isCloseMode to prevent the bot from "Panic Closing"
    const shouldReduce = false; 
    const shouldPostOnly = true;

    if (quote.bidSize > 0) {
      orders.push({
        symbol: this.config.symbol,
        side: "buy",
        type: "limit",
        price: this.roundToTick(quote.bidPrice, "down"),
        size: this.roundSize(quote.bidSize),
        postOnly: shouldPostOnly,
        reduceOnly: shouldReduce,
      });
    }

    if (quote.askSize > 0) {
      orders.push({
        symbol: this.config.symbol,
        side: "sell",
        type: "limit",
        price: this.roundToTick(quote.askPrice, "up"),
        size: this.roundSize(quote.askSize),
        postOnly: shouldPostOnly,
        reduceOnly: shouldReduce,
      });
    }

    return orders;
  }

  /**
   * Round price to tick size
   */
private roundToTick(price: number, direction: "up" | "down"): number {
  const tickSize = 
    (this.config.symbol === "BTC" || this.config.symbol === "ETH") ? 0.1 : 
    (this.config.symbol === "HYPE") ? 0.01 : 
    0.00001;

  if (direction === "down") {
    // For Bids: Round down further to stay away from the Ask
    return Math.floor(price / tickSize) * tickSize;
  }
  // For Asks: Round up further to stay away from the Bid
  return Math.ceil(price / tickSize) * tickSize;
}

  /**
   * Round size to precision
   */
  private roundSize(size: number): number {
    if (!this.market) return size;

    const precision = this.market.sizePrecision;
    const multiplier = 10 ** precision;
    return Math.floor(size * multiplier) / multiplier;
  }

  /**
   * Check if an order price is stale (too far from fair price)
   * @param orderPrice - Current order price
   * @param orderSide - Order side
   * @param fairPrice - Current fair price
   * @param maxDeviationBps - Maximum allowed deviation in bps
   */
  isOrderStale(
    orderPrice: number,
    _orderSide: Side,
    fairPrice: number,
    maxDeviationBps = 50
  ): boolean {
    const deviation = Math.abs(orderPrice - fairPrice) / fairPrice;
    const deviationBps = deviation * 10000;
    return deviationBps > maxDeviationBps;
  }
}
