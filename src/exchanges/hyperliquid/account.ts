import type { InfoClient } from "@nktkas/hyperliquid";
import type { Account as ViemAccount } from "viem";
import type { Account, Position } from "../../types.js";
import { logger } from "../../utils/logger.js";

/**
 * Get account information from Hyperliquid
 * Fetches clearinghouse state including margin, equity, and positions
 */
export async function getAccount(infoClient: InfoClient, wallet: ViemAccount): Promise<Account> {
  try {
    // Fetch clearinghouse state for the wallet address
    const state = await infoClient.clearinghouseState({ user: wallet.address });

    // The clearinghouseState returns margin summary and asset positions
    const marginSummary = state.marginSummary;

    // Convert to common Account type
    const account: Account = {
      address: wallet.address,
      equity: Number.parseFloat(marginSummary.accountValue),
      margin: Number.parseFloat(marginSummary.totalMarginUsed),
      availableMargin:
        Number.parseFloat(marginSummary.accountValue) -
        Number.parseFloat(marginSummary.totalMarginUsed),
      raw: state,
    };

    logger.debug(`Fetched Hyperliquid account: equity=${account.equity}, margin=${account.margin}`);

    return account;
  } catch (error) {
    logger.error("Failed to fetch Hyperliquid account", error);
    throw error;
  }
}

/**
 * Get all open positions from Hyperliquid
 * Extracts position data from clearinghouse state
 */
export async function getPositions(
  infoClient: InfoClient,
  wallet: ViemAccount
): Promise<Position[]> {
  try {
    // Fetch clearinghouse state for the wallet address
    const state = await infoClient.clearinghouseState({ user: wallet.address });

    // Extract asset positions from the state
    const positions: Position[] = state.assetPositions
      .filter((pos) => {
        // Filter out positions with zero size
        const size = Number.parseFloat(pos.position.szi);
        return size !== 0;
      })
      .map((pos) => {
        const size = Number.parseFloat(pos.position.szi);
        const entryPrice = Number.parseFloat(pos.position.entryPx);
        const unrealizedPnl = Number.parseFloat(pos.position.unrealizedPnl);
        const markPrice = pos.position.positionValue
          ? Number.parseFloat(pos.position.positionValue) / Math.abs(size)
          : undefined;

        // Handle liquidation price - could be string, number, or undefined
        let liquidationPrice: number | undefined;
        if (pos.position.liquidationPx) {
          liquidationPrice =
            typeof pos.position.liquidationPx === "string"
              ? Number.parseFloat(pos.position.liquidationPx)
              : pos.position.liquidationPx;
        }

        // Handle leverage - could be string, number, or undefined
        let leverage: number | undefined;
        if (pos.position.leverage?.value) {
          leverage =
            typeof pos.position.leverage.value === "string"
              ? Number.parseFloat(pos.position.leverage.value)
              : pos.position.leverage.value;
        }

        return {
          symbol: pos.position.coin,
          side: size > 0 ? ("long" as const) : size < 0 ? ("short" as const) : ("none" as const),
          size: Math.abs(size),
          entryPrice,
          markPrice,
          liquidationPrice,
          unrealizedPnl,
          leverage,
          margin: pos.position.marginUsed ? Number.parseFloat(pos.position.marginUsed) : undefined,
          raw: pos,
        };
      });

    logger.debug(`Fetched ${positions.length} Hyperliquid positions`);

    return positions;
  } catch (error) {
    logger.error("Failed to fetch Hyperliquid positions", error);
    throw error;
  }
}
