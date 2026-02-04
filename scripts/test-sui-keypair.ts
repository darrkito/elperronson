import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64 } from "@mysten/sui/utils";

// Generate a test keypair
const keypair = new Ed25519Keypair();

console.log("Wallet Address:", keypair.getPublicKey().toSuiAddress());
console.log("Public Key Base64:", keypair.getPublicKey().toBase64());

// Get the secret key
const secretKey = keypair.getSecretKey();
console.log("Secret Key Type:", typeof secretKey);
console.log("Secret Key:", secretKey);

// Try to get bytes
try {
  const rawBytes = keypair.getPublicKey().toRawBytes();
  console.log("Public key raw bytes length:", rawBytes.length);
} catch (e) {
  console.log("Raw bytes error:", e);
}
