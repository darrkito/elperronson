import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { logger } from "../../utils/logger.js";

/**
 * Sui Wallet Signer
 * Handles transaction signing for Aftermath Perpetuals on Sui
 */
export class SuiSigner {
  private keypair: Ed25519Keypair;
  private walletAddress: string;

  /**
   * Create a new Sui signer from private key
   * @param privateKey - Can be:
   *   - Bech32 encoded private key (suiprivkey1...)
   *   - Base64-encoded Ed25519 private key (32 or 64 bytes)
   */
  constructor(privateKey?: string) {
    const key = privateKey || process.env.SUI_PRIVATE_KEY;

    if (!key) {
      throw new Error("SUI_PRIVATE_KEY environment variable is required");
    }

    try {
      // Check if it's a Bech32-encoded key (starts with "suiprivkey1")
      if (key.startsWith("suiprivkey1")) {
        // Use the fromSecretKey method which handles Bech32 format
        this.keypair = Ed25519Keypair.fromSecretKey(key);
      } else {
        // Assume it's Base64-encoded bytes
        const privateKeyBytes = fromBase64(key);

        // Create Ed25519 keypair from the private key
        // If the key is 32 bytes, it's a seed. If 64 bytes, it's a full keypair
        if (privateKeyBytes.length === 32) {
          // 32-byte seed - use fromSecretKey
          this.keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
        } else if (privateKeyBytes.length === 64) {
          // 64-byte keypair - extract the first 32 bytes as seed
          const seed = privateKeyBytes.slice(0, 32);
          this.keypair = Ed25519Keypair.fromSecretKey(seed);
        } else {
          throw new Error(
            `Invalid private key length: ${privateKeyBytes.length} bytes. Expected 32 or 64 bytes.`
          );
        }
      }

      // Derive wallet address from keypair
      this.walletAddress = this.keypair.getPublicKey().toSuiAddress();

      logger.info(`SuiSigner initialized for address: ${this.walletAddress}`);
    } catch (error) {
      logger.error("Failed to initialize SuiSigner:", error);
      throw new Error(`Failed to initialize SuiSigner: ${error}`);
    }
  }

  /**
   * Sign a transaction digest
   * @param txDigest - Transaction digest bytes to sign (typically from build response)
   * @returns Base64-encoded Sui signature format
   */
  async signTransaction(txDigest: Uint8Array): Promise<string> {
    try {
      logger.debug(`Signing transaction digest: ${toBase64(txDigest)}`);

      // Sign the transaction digest using the keypair
      const signature = await this.keypair.sign(txDigest);

      // Return Base64-encoded signature
      const signatureBase64 = toBase64(signature);
      logger.debug(`Transaction signed: ${signatureBase64}`);

      return signatureBase64;
    } catch (error) {
      logger.error("Failed to sign transaction:", error);
      throw new Error(`Failed to sign transaction: ${error}`);
    }
  }

  /**
   * Sign a transaction digest from a hex string
   * @param txDigestHex - Transaction digest as hex string
   * @returns Base64-encoded Sui signature format
   */
  async signTransactionHex(txDigestHex: string): Promise<string> {
    // Remove 0x prefix if present
    const hex = txDigestHex.startsWith("0x") ? txDigestHex.slice(2) : txDigestHex;

    // Convert hex to bytes
    const txDigest = new Uint8Array(
      hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) || []
    );

    return this.signTransaction(txDigest);
  }

  /**
   * Get the wallet address derived from the keypair
   * @returns Sui wallet address (0x... format)
   */
  getWalletAddress(): string {
    return this.walletAddress;
  }

  /**
   * Get the public key in Base64 format
   * @returns Base64-encoded public key
   */
  getPublicKeyBase64(): string {
    return this.keypair.getPublicKey().toBase64();
  }

  /**
   * Get the public key bytes
   * @returns Public key as Uint8Array
   */
  getPublicKeyBytes(): Uint8Array {
    return this.keypair.getPublicKey().toRawBytes();
  }
}

/**
 * Create a SuiSigner instance from environment variables
 * @returns Configured SuiSigner instance
 */
export function createSuiSigner(): SuiSigner {
  return new SuiSigner();
}
