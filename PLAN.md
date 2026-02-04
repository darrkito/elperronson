# Multi-Exchange Perpetuals Market Maker Bot

## Project Overview

Build a simple market maker bot supporting **Aftermath Perpetuals** (Sui) and **Hyperliquid**, using **Binance** as the price oracle. Fork architecture from [zo-market-maker-ts](https://github.com/yat1ma30/zo-market-maker-ts).

## Goal

Create an automated market maker that:
- Quotes bid/ask around a fair price (derived from Binance spot)
- Supports multiple perpetual exchanges (Aftermath, Hyperliquid)
- Manages position risk with configurable thresholds per exchange
- Runs autonomously with Docker support
- Provides real-time monitoring via TUI

## Success Criteria

1. Bot connects to both Aftermath Perpetuals and Hyperliquid
2. Bot streams orderbook and account data in real-time via WebSocket
3. Bot places/cancels limit orders based on Binance fair price + spread
4. Bot manages position size per exchange with close mode
5. Bot handles errors gracefully and reconnects automatically
6. Exchange adapters are modular (easy to add new exchanges)
7. Docker deployment works for all exchanges

## Tech Stack

- **Runtime**: Node.js v20+ / Bun
- **Language**: TypeScript
- **Exchanges**:
  - Aftermath Perpetuals: `@aftermath-finance/sdk`
  - Hyperliquid: `@nktkas/hyperliquid`
- **Price Feed**: Binance WebSocket
- **Linting**: Biome
- **Deployment**: Docker + docker-compose

## Architecture

```
src/
├── bots/mm/                    # Market Maker bot
│   ├── index.ts                # MarketMaker class (main loop)
│   ├── config.ts               # Configuration
│   ├── position.ts             # Position tracking (per exchange)
│   └── quoter.ts               # Quote generation logic
├── cli/                        # Entry points
│   ├── bot.ts                  # Bot CLI
│   └── monitor.ts              # Market monitor TUI
├── exchanges/                  # Exchange adapters (unified interface)
│   ├── types.ts                # Common exchange interface
│   ├── aftermath/              # Aftermath Perpetuals adapter
│   │   ├── client.ts           # SDK initialization
│   │   ├── account.ts          # Account/position management
│   │   ├── orderbook.ts        # WebSocket orderbook stream
│   │   ├── orders.ts           # Order placement/cancellation
│   │   └── markets.ts          # Market discovery
│   └── hyperliquid/            # Hyperliquid adapter
│       ├── client.ts           # SDK client wrapper
│       ├── account.ts          # Account management
│       ├── orderbook.ts        # L2 book subscription
│       ├── orders.ts           # Order operations
│       └── markets.ts          # Market info
├── pricing/                    # Price feeds
│   ├── binance.ts              # Binance WebSocket (reuse from zo-mm)
│   └── fair-price.ts           # Fair price calculation
├── utils/                      # Utilities
│   └── logger.ts               # Logging
└── types.ts                    # Shared types
```

## Exchange Comparison

| Feature | Aftermath Perpetuals | Hyperliquid |
|---------|---------------------|-------------|
| Blockchain | Sui | HyperCore L1 |
| API | CCXT REST API + SDK | `@nktkas/hyperliquid` SDK |
| Order Book | Fully on-chain | On-chain (HyperCore) |
| WebSocket/SSE | Yes (orderbook, positions, orders, trades) | Yes (L2Book, trades, user) |
| Order Types | Market, Limit (GTC, IOC, FOK, PO) | Market, Limit (GTC, IOC, ALO) |
| Collateral | USDC on Sui | USDC |
| Transaction Model | Build → Sign → Submit (two-phase) | Direct API calls |

## Aftermath CCXT REST API

The Aftermath Perpetuals protocol provides a **CCXT-compatible REST API** that simplifies blockchain interactions.

### Base URLs

| Environment | URL |
|-------------|-----|
| Mainnet Preview | `https://mainnet-perpetuals-preview.aftermath.finance` |
| Production | `https://aftermath.finance` |
| Testnet | `https://testnet.aftermath.finance` |

### Transaction Workflow

All write operations use a two-phase build/submit pattern:

1. **Build**: Call `/api/ccxt/build/*` → returns `transactionBytes` + `signingDigest`
2. **Sign**: Client signs `signingDigest` with Sui wallet (Ed25519/Secp256k1)
3. **Submit**: Send `transactionBytes` + `signatures[]` to `/api/ccxt/submit/*`

### Key Endpoints

#### Account Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ccxt/markets` | List all available markets |
| POST | `/api/ccxt/accounts` | Get accounts for a wallet address |
| POST | `/api/ccxt/build/createAccount` | Build create account transaction |
| POST | `/api/ccxt/submit/createAccount` | Submit signed create account tx |

#### Trading
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ccxt/build/createOrders` | Build order placement transaction |
| POST | `/api/ccxt/submit/createOrders` | Submit signed orders tx |
| POST | `/api/ccxt/build/cancelOrders` | Build cancel orders transaction |
| POST | `/api/ccxt/submit/cancelOrders` | Submit signed cancel tx |
| POST | `/api/ccxt/myPendingOrders` | Get pending orders for account |

#### Market Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ccxt/orderbook` | Get orderbook snapshot |
| POST | `/api/ccxt/positions` | Get account positions |
| POST | `/api/ccxt/balance` | Get account balance |

#### WebSocket Streams (Server-Sent Events)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ccxt/stream/orderbook?chId={marketId}` | Stream orderbook deltas |
| GET | `/api/ccxt/stream/orders?chId={marketId}` | Stream order updates |
| GET | `/api/ccxt/stream/positions?accountNumber={num}` | Stream position updates |
| GET | `/api/ccxt/stream/trades?chId={marketId}` | Stream trades |

### Key Types

```typescript
// Transaction metadata (required for all build requests)
interface TransactionMetadata {
  sender: string;           // Wallet address
  gasBudget?: number;       // Max SUI MIST
  gasPrice?: number;        // SUI MIST per gas unit
}

// Order request for createOrders
interface OrderRequest {
  chId: string;                    // Market ID (from markets endpoint)
  type: "market" | "limit";
  side: "buy" | "sell";
  amount?: number;                 // Base currency amount
  price?: number;                  // Required for limit orders
  reduceOnly?: boolean;
  expirationTimestampMs?: number;
}

// Transaction build response
interface TransactionBuildResponse {
  transactionBytes: string;  // Base64 BCS-encoded transaction
  signingDigest: string;     // Base64 32-byte digest to sign
}

// Submit request (same for all submit endpoints)
interface SubmitTransactionRequest {
  transactionBytes: string;  // From build response
  signatures: string[];      // Base64 Sui signatures
}

// Orderbook response
interface OrderBook {
  bids: [price: number, amount: number][];
  asks: [price: number, amount: number][];
  timestamp?: number;
  nonce?: number;  // For tracking deltas
}

// Position response
interface Position {
  symbol: string;
  side?: "long" | "short";
  contracts?: number;
  entryPrice?: number;
  leverage?: number;
  collateral?: number;
  unrealizedPnl?: number;
  liquidationPrice?: number;
}

// Order response
interface Order {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type?: "market" | "limit";
  status: "open" | "closed" | "canceled" | "expired" | "rejected";
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  timestamp: number;
  reduceOnly?: boolean;
}
```

### Key Identifiers

| Identifier | Description | Source |
|------------|-------------|--------|
| `chId` | Clearing house / Market ID | `Market.id` from `/api/ccxt/markets` |
| `accountCapId` | Account capability object ID | `Account.id` where `type == "capability"` |
| `accountNumber` | Numerical account identifier | `Account.accountNumber` |
| `walletAddress` | Sui wallet address | User's wallet |

## Implementation Steps

### Phase 1: Project Setup
1. Initialize project with package.json and dependencies
2. Set up TypeScript config (tsconfig.json)
3. Set up Biome for linting (biome.json)
4. Create .env.example with multi-exchange environment variables
5. Define common exchange interface (`IExchange`) in `src/exchanges/types.ts`
6. Create shared types in `src/types.ts`

### Phase 2: Hyperliquid Integration
7. Create Hyperliquid client wrapper (`src/exchanges/hyperliquid/client.ts`)
8. Implement market discovery (`src/exchanges/hyperliquid/markets.ts`)
9. Implement L2 book WebSocket subscription (`src/exchanges/hyperliquid/orderbook.ts`)
10. Implement account/position management (`src/exchanges/hyperliquid/account.ts`)
11. Implement order placement and cancellation (`src/exchanges/hyperliquid/orders.ts`)
12. Create unified Hyperliquid adapter implementing IExchange

### Phase 3: Aftermath Integration (CCXT REST API)
13. Create Aftermath API client (`src/exchanges/aftermath/client.ts`)
14. Implement Sui wallet signing utilities (`src/exchanges/aftermath/signer.ts`)
15. Implement market discovery via `/api/ccxt/markets`
16. Implement orderbook fetching and SSE streaming (`src/exchanges/aftermath/orderbook.ts`)
17. Implement account discovery and position fetching (`src/exchanges/aftermath/account.ts`)
18. Implement build/sign/submit order flow (`src/exchanges/aftermath/orders.ts`)
19. Create unified Aftermath adapter implementing IExchange

### Phase 4: Price Feed
20. Implement Binance WebSocket price feed (`src/pricing/binance.ts`)
21. Implement fair price calculator with EMA (`src/pricing/fair-price.ts`)

### Phase 5: Market Maker Logic
22. Implement quote generator with spread calculation (`src/bots/mm/quoter.ts`)
23. Implement position manager with per-exchange tracking (`src/bots/mm/position.ts`)
24. Implement market maker configuration (`src/bots/mm/config.ts`)
25. Implement main market maker loop (`src/bots/mm/index.ts`)
26. Add close mode logic (reduce-only orders when position exceeds threshold)

### Phase 6: CLI & Entry Points
27. Create bot CLI entry point (`src/cli/bot.ts`)
28. Add exchange selection via CLI flags (--exchange, --symbol)
29. Create market monitor TUI (`src/cli/monitor.ts`)

### Phase 7: Testing & Deployment
30. Write integration tests per exchange adapter
31. Create Dockerfile for containerized deployment
32. Create docker-compose.yml with services per exchange
33. Write README with usage documentation

## Common Exchange Interface

```typescript
interface IExchange {
  name: string;
  
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // Market data
  getMarkets(): Promise<Market[]>;
  subscribeOrderbook(symbol: string, callback: (book: Orderbook) => void): void;
  unsubscribeOrderbook(symbol: string): void;
  
  // Account
  getAccount(): Promise<Account>;
  getPositions(): Promise<Position[]>;
  getOpenOrders(symbol?: string): Promise<Order[]>;
  
  // Trading
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(symbol?: string): Promise<void>;
}

interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  type: 'limit' | 'market';
  postOnly?: boolean;
  reduceOnly?: boolean;
  clientId?: string;
}
```

## Aftermath CCXT REST API Usage

```typescript
// Using the CCXT REST API (recommended approach)
const BASE_URL = "https://mainnet-perpetuals-preview.aftermath.finance";

// 1. Get markets
const markets = await fetch(`${BASE_URL}/api/ccxt/markets`).then(r => r.json());
const btcMarket = markets.find(m => m.symbol === "BTC/USD:USDC");
const chId = btcMarket.id;

// 2. Get accounts for wallet
const accounts = await fetch(`${BASE_URL}/api/ccxt/accounts`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: walletAddress })
}).then(r => r.json());
const accountCap = accounts.find(a => a.type === "capability");

// 3. Get orderbook
const orderbook = await fetch(`${BASE_URL}/api/ccxt/orderbook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chId })
}).then(r => r.json());

// 4. Stream orderbook updates (Server-Sent Events)
const eventSource = new EventSource(`${BASE_URL}/api/ccxt/stream/orderbook?chId=${chId}`);
eventSource.onmessage = (event) => {
  const delta = JSON.parse(event.data);
  // Update local orderbook with deltas
};

// 5. Place limit order (build → sign → submit)
// Step 5a: Build transaction
const buildResponse = await fetch(`${BASE_URL}/api/ccxt/build/createOrders`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    accountId: accountCap.id,
    orders: [{
      chId,
      type: "limit",
      side: "buy",
      amount: 0.001,    // BTC amount
      price: 95000,
    }],
    deallocateFreeCollateral: false,
    metadata: { sender: walletAddress }
  })
}).then(r => r.json());

// Step 5b: Sign the digest with Sui wallet
const signature = await signWithSuiWallet(buildResponse.signingDigest);

// Step 5c: Submit signed transaction
const orders = await fetch(`${BASE_URL}/api/ccxt/submit/createOrders`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    transactionBytes: buildResponse.transactionBytes,
    signatures: [signature]
  })
}).then(r => r.json());

// 6. Cancel orders
const cancelBuild = await fetch(`${BASE_URL}/api/ccxt/build/cancelOrders`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    accountId: accountCap.id,
    chId,
    orderIds: orders.map(o => o.id),
    deallocateFreeCollateral: false,
    metadata: { sender: walletAddress }
  })
}).then(r => r.json());
// Sign and submit...
```

## Sui Wallet Signing

```typescript
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";

// Initialize keypair from private key
const keypair = Ed25519Keypair.fromSecretKey(fromBase64(privateKeyBase64));

// Sign transaction digest
function signTransaction(signingDigest: string): string {
  const digestBytes = fromBase64(signingDigest);
  const { signature } = keypair.signPersonalMessage(digestBytes);
  return signature; // Base64-encoded Sui signature
}
```

## Hyperliquid SDK Usage

```typescript
import { HttpTransport, InfoClient, ExchangeClient, 
         SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

// Info (public data)
const transport = new HttpTransport();
const info = new InfoClient({ transport });
const mids = await info.allMids();
const book = await info.l2Book({ coin: "BTC" });

// Exchange (authenticated)
const wallet = privateKeyToAccount("0x...");
const exchange = new ExchangeClient({ transport, wallet });
const result = await exchange.order({
  orders: [{
    a: 0,           // asset index (BTC=0)
    b: true,        // is_buy
    p: "95000",     // price
    s: "0.01",      // size
    r: false,       // reduce_only
    t: { limit: { tif: "Gtc" } },
  }],
  grouping: "na",
});

// WebSocket subscriptions
const wsTransport = new WebSocketTransport();
const subs = new SubscriptionClient({ transport: wsTransport });
await subs.l2Book({ coin: "BTC" }, (data) => {
  console.log("L2 book update:", data);
});
```

## Configuration

```typescript
export const DEFAULT_CONFIG = {
  // Spread settings
  spreadBps: 10,              // 10 bps = 0.1% from fair price
  takeProfitBps: 5,           // Tighter spread in close mode
  
  // Position limits
  orderSizeUsd: 100,          // Order size in USD
  closeThresholdUsd: 500,     // Switch to close mode threshold
  
  // Timing
  warmupSeconds: 10,          // Wait before quoting
  updateThrottleMs: 100,      // Min interval between updates
  orderSyncIntervalMs: 3000,  // Sync orders interval
  
  // Fair price
  fairPriceWindowMs: 300000,  // 5 min window for fair price calc
}
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `EXCHANGE` | Exchange to use: `aftermath`, `hyperliquid` | Yes |
| `SYMBOL` | Trading pair (e.g., `BTC`, `ETH`) | Yes |
| **Aftermath** | | |
| `SUI_PRIVATE_KEY` | Sui wallet private key | For Aftermath |
| `SUI_WALLET_ADDRESS` | Sui wallet address | For Aftermath |
| `AF_COLLATERAL_TYPE` | Collateral coin type | For Aftermath |
| **Hyperliquid** | | |
| `HL_PRIVATE_KEY` | EVM private key for Hyperliquid | For Hyperliquid |
| `HL_TESTNET` | Use testnet (`true`/`false`) | No |
| **General** | | |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | No |

## Risks & Considerations

1. **Liquidation Risk**: Monitor margin ratio on both exchanges
2. **Stale Prices**: Binance latency affects quote accuracy
3. **Exchange Downtime**: Handle API failures gracefully
4. **Rate Limits**: 
   - Hyperliquid: Check docs
   - Aftermath: 1000 req/10s
5. **Transaction Costs**: Sui gas (Aftermath), minimal for Hyperliquid

## Commands

```bash
# Install dependencies
npm install

# Setup
cp .env.example .env
# Edit .env with your keys

# Run bot on Hyperliquid
npm run bot -- --exchange hyperliquid --symbol BTC

# Run bot on Aftermath
npm run bot -- --exchange aftermath --symbol BTC

# Monitor market
npm run monitor -- --exchange hyperliquid --symbol BTC

# Docker (runs both)
docker compose up -d
```

## Dependencies

```json
{
  "dependencies": {
    "@nktkas/hyperliquid": "^0.30.0",
    "@mysten/sui": "^1.x",
    "viem": "^2.x",
    "ws": "^8.x",
    "eventsource": "^2.x",
    "dotenv": "^16.x",
    "commander": "^12.x"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.x",
    "@types/node": "^20.x",
    "@types/eventsource": "^1.x",
    "typescript": "^5.x",
    "vitest": "^2.x"
  }
}
```

**Note**: We use the Aftermath CCXT REST API instead of the SDK for simpler integration and better control over the transaction flow.

## References

- [zo-market-maker-ts (reference)](https://github.com/yat1ma30/zo-market-maker-ts)
- [Hyperliquid TS SDK](https://github.com/nktkas/hyperliquid)
- [Hyperliquid SDK Docs](https://nktkas.gitbook.io/hyperliquid)
- [Aftermath CCXT API](https://mainnet-perpetuals-preview.aftermath.finance/api/openapi/spec.json)
- [Aftermath Perpetuals Docs](https://docs.aftermath.finance/perpetuals/aftermath-perpetuals)
- [Sui TypeScript SDK](https://sdk.mystenlabs.com/typescript)

## Completion Promise

<promise>COMPLETE</promise>
