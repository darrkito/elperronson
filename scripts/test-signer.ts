import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiSigner } from "../src/exchanges/aftermath/signer.js";

// Generate a test keypair
const testKeypair = new Ed25519Keypair();
const privateKey = testKeypair.getSecretKey();

console.log("Generated test keypair");
console.log(`Private key format: ${privateKey.substring(0, 20)}...`);

// Create a signer
const signer = new SuiSigner(privateKey);

console.log("\nSigner initialized:");
console.log("Wallet address:", signer.getWalletAddress());
console.log("Public key (Base64):", signer.getPublicKeyBase64());

// Test signing
const testDigest = new Uint8Array(32);
for (let i = 0; i < 32; i++) {
  testDigest[i] = i;
}

console.log("\nSigning test transaction...");
const signature = await signer.signTransaction(testDigest);
console.log(`Signature: ${signature.substring(0, 40)}...`);

// Test signing from hex
const testHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
console.log("\nSigning from hex:", testHex);
const signatureHex = await signer.signTransactionHex(testHex);
console.log(`Signature: ${signatureHex.substring(0, 40)}...`);

console.log("\nSigner test complete!");
