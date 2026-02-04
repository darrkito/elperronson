import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64 } from "@mysten/sui/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { SuiSigner } from "../src/exchanges/aftermath/signer.js";

describe("SuiSigner", () => {
  let testPrivateKey: string;
  let testKeypair: Ed25519Keypair;

  beforeEach(() => {
    // Generate a test keypair
    testKeypair = new Ed25519Keypair();
    // Export the keypair - getSecretKey() returns a Bech32-encoded string
    testPrivateKey = testKeypair.getSecretKey();
  });

  it("should initialize with a private key", () => {
    const signer = new SuiSigner(testPrivateKey);
    expect(signer.getWalletAddress()).toBeTruthy();
    expect(signer.getWalletAddress()).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("should throw error if no private key provided", () => {
    expect(() => new SuiSigner("")).toThrow();
  });

  it("should derive correct wallet address", () => {
    const signer = new SuiSigner(testPrivateKey);
    const expectedAddress = testKeypair.getPublicKey().toSuiAddress();
    expect(signer.getWalletAddress()).toBe(expectedAddress);
  });

  it("should return public key in Base64 format", () => {
    const signer = new SuiSigner(testPrivateKey);
    const publicKeyBase64 = signer.getPublicKeyBase64();
    expect(publicKeyBase64).toBeTruthy();
    expect(typeof publicKeyBase64).toBe("string");
  });

  it("should return public key bytes", () => {
    const signer = new SuiSigner(testPrivateKey);
    const publicKeyBytes = signer.getPublicKeyBytes();
    expect(publicKeyBytes).toBeInstanceOf(Uint8Array);
    expect(publicKeyBytes.length).toBeGreaterThan(0);
  });

  it("should sign a transaction digest", async () => {
    const signer = new SuiSigner(testPrivateKey);

    // Create a test transaction digest
    const testDigest = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      testDigest[i] = i;
    }

    const signature = await signer.signTransaction(testDigest);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe("string");

    // Base64 signature should be valid
    expect(() => Buffer.from(signature, "base64")).not.toThrow();
  });

  it("should sign a transaction digest from hex string", async () => {
    const signer = new SuiSigner(testPrivateKey);

    // Create a test hex digest (32 bytes = 64 hex chars)
    const testDigestHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const signature = await signer.signTransactionHex(testDigestHex);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe("string");
  });

  it("should handle hex string with 0x prefix", async () => {
    const signer = new SuiSigner(testPrivateKey);

    const testDigestHex = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const signature = await signer.signTransactionHex(testDigestHex);
    expect(signature).toBeTruthy();
  });

  it("should produce consistent signatures for same digest", async () => {
    const signer = new SuiSigner(testPrivateKey);

    const testDigest = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      testDigest[i] = i;
    }

    const signature1 = await signer.signTransaction(testDigest);
    const signature2 = await signer.signTransaction(testDigest);

    expect(signature1).toBe(signature2);
  });
});
