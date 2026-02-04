// Shared types used across the application

export type Side = "buy" | "sell";
export type OrderType = "limit" | "market";
export type OrderStatus = "open" | "closed" | "canceled" | "expired" | "rejected";

export interface Market {
  id: string; // Exchange-specific market identifier
  symbol: string; // Standardized symbol (e.g., "BTC/USD:USDC")
  base: string; // Base currency (e.g., "BTC")
  quote: string; // Quote currency (e.g., "USD")
  pricePrecision: number; // Number of decimal places for price
  sizePrecision: number; // Number of decimal places for size
  minSize: number; // Minimum order size
  maxSize?: number; // Maximum order size (optional)
  tickSize: number; // Minimum price increment
  raw?: unknown; // Original exchange-specific market data
}

export interface Orderbook {
  symbol: string;
  bids: [price: number, size: number][]; // Sorted descending by price
  asks: [price: number, size: number][]; // Sorted ascending by price
  timestamp: number; // Unix timestamp in milliseconds
  nonce?: number; // For tracking updates
}

export interface Account {
  address: string; // Wallet/account address
  equity: number; // Total account value
  margin: number; // Margin used
  availableMargin: number; // Available margin
  leverage?: number; // Account leverage
  raw?: unknown; // Original exchange-specific account data
}

export interface Position {
  symbol: string;
  side: "long" | "short" | "none";
  size: number; // Position size (positive for long, negative for short)
  entryPrice: number;
  markPrice?: number;
  liquidationPrice?: number;
  unrealizedPnl: number;
  realizedPnl?: number;
  leverage?: number;
  margin?: number;
  raw?: unknown; // Original exchange-specific position data
}

export interface Order {
  id: string; // Exchange order ID
  clientId?: string; // Client-provided order ID
  symbol: string;
  type: OrderType;
  side: Side;
  price: number;
  size: number;
  filled: number; // Amount filled
  remaining: number; // Amount remaining
  status: OrderStatus;
  timestamp: number; // Unix timestamp in milliseconds
  reduceOnly?: boolean;
  postOnly?: boolean;
  raw?: unknown; // Original exchange-specific order data
}

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  price: number; // Required for limit orders
  size: number;
  postOnly?: boolean; // Post-only (maker-only) flag
  reduceOnly?: boolean; // Reduce-only flag for closing positions
  clientId?: string; // Optional client-provided ID
}

export interface OrderResult {
  orderId: string; // Exchange-assigned order ID
  clientId?: string; // Client-provided ID (if any)
  status: OrderStatus;
  timestamp: number;
  raw?: unknown; // Original exchange response
}
