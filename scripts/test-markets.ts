import { createHyperliquidClient } from "../src/exchanges/hyperliquid/client.js";
import { getMarkets } from "../src/exchanges/hyperliquid/markets.js";

async function main() {
  const clients = createHyperliquidClient({
    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
    isTestnet: true,
  });

  const markets = await getMarkets(clients);

  console.log(`Found ${markets.length} markets`);
  console.log("\nFirst 10 markets:");
  for (const market of markets.slice(0, 10)) {
    console.log(
      `  ${market.symbol} - ID: ${market.id}, Size Precision: ${market.sizePrecision}, Price Precision: ${market.pricePrecision}`
    );
  }

  // Find markets with 0 size precision
  const zeroSizePrecision = markets.filter((m) => m.sizePrecision === 0);
  if (zeroSizePrecision.length > 0) {
    console.log(`\nMarkets with 0 size precision (${zeroSizePrecision.length}):`);
    for (const market of zeroSizePrecision.slice(0, 5)) {
      console.log(`  ${market.symbol} - szDecimals: ${(market.raw as any)?.szDecimals}`);
    }
  }
}

main().catch(console.error);
