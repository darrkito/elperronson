import type { Position } from "../../types.js";
import { logger } from "../../utils/logger.js";
import type { MarketMakerConfig } from "./config.js";

/**
 * Position state for a single symbol
 */
export interface PositionState {
  symbol: string;
  side: "long" | "short" | "none";
  size: number;
  entryPrice: number;
  markPrice: number;
  notional: number; // size * markPrice
  unrealizedPnl: number;
  margin: number;
}

/**
 * Position manager for tracking and risk management
 */
export class PositionManager {
  private config: MarketMakerConfig;
  private position: PositionState;

  constructor(config: MarketMakerConfig) {
    this.config = config;
    this.position = {
      symbol: config.symbol,
      side: "none",
      size: 0,
      entryPrice: 0,
      markPrice: 0,
      notional: 0,
      unrealizedPnl: 0,
      margin: 0,
    };
  }

  /**
   * Update position state from exchange position data
   */
  updatePosition(exchangePosition: Position | null, markPrice?: number): void {
    if (!exchangePosition || exchangePosition.size === 0) {
      // No position
      this.position = {
        symbol: this.config.symbol,
        side: "none",
        size: 0,
        entryPrice: 0,
        markPrice: markPrice || 0,
        notional: 0,
        unrealizedPnl: 0,
        margin: 0,
      };
      return;
    }

    const price = markPrice || exchangePosition.markPrice || exchangePosition.entryPrice;
    const size = Math.abs(exchangePosition.size);
    const notional = size * price;

    this.position = {
      symbol: this.config.symbol,
      side: exchangePosition.side === "none" ? "none" : exchangePosition.side,
      size,
      entryPrice: exchangePosition.entryPrice,
      markPrice: price,
      notional,
      unrealizedPnl: exchangePosition.unrealizedPnl,
      margin: exchangePosition.margin || 0,
    };

    logger.debug(
      `Position updated: ${this.position.side} ${this.position.size} @ ${this.position.entryPrice}, notional=$${notional.toFixed(2)}`
    );
  }

  /**
   * Get current position state
   */
  getPosition(): PositionState {
    return { ...this.position };
  }

  /**
   * Get signed notional value (positive for long, negative for short)
   */
  getSignedNotional(): number {
    if (this.position.side === "long") {
      return this.position.notional;
    }
    if (this.position.side === "short") {
      return -this.position.notional;
    }
    return 0;
  }

  /**
   * Check if in close mode (position exceeds threshold)
   */
  isCloseMode(): boolean {
    return this.position.notional > this.config.closeThresholdUsd;
  }

  /**
   * Check if position is at max (should stop opening new positions)
   */
  isAtMax(): boolean {
    return this.position.notional >= this.config.maxPositionUsd;
  }

  /**
   * Check if it's safe to add to position on given side
   */
  canAddPosition(side: "buy" | "sell"): boolean {
    // If at max, can't add any position
    if (this.isAtMax()) {
      return false;
    }

    // In close mode, can only reduce
    if (this.isCloseMode()) {
      // Can only add if it reduces position
      if (this.position.side === "long" && side === "buy") {
        return false;
      }
      if (this.position.side === "short" && side === "sell") {
        return false;
      }
    }

    return true;
  }

  /**
   * Get position utilization as percentage of max
   */
  getUtilization(): number {
    return this.position.notional / this.config.maxPositionUsd;
  }

  /**
   * Format position for logging
   */
  formatPosition(): string {
    if (this.position.side === "none") {
      return "No position";
    }

    const pnlSign = this.position.unrealizedPnl >= 0 ? "+" : "";
    return `${this.position.side.toUpperCase()} ${this.position.size.toFixed(6)} @ ${this.position.entryPrice.toFixed(2)} | Notional: $${this.position.notional.toFixed(2)} | PnL: ${pnlSign}$${this.position.unrealizedPnl.toFixed(2)}`;
  }
}
