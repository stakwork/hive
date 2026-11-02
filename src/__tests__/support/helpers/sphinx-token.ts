/**
 * Sphinx tokens as a client signs them (docs/plans/sphinx-token-binding.md):
 * base64 of a 4-byte big-endian timestamp and a 65-byte recoverable signature
 * over "Lightning Signed Message:" + the payload, double SHA-256 — what the
 * Sphinx core's `sign_base64` makes. The bare payload is the timestamp; the
 * bound one is `sphinxTokenBoundPayload`.
 */
import { getPublicKey, signAsync, utils } from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { sphinxTokenBoundPayload, type SphinxTokenBinding } from "@/lib/auth/sphinx-verify";

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function timestampBytes(at: number): Buffer {
  const stamp = Buffer.alloc(4);
  stamp.writeUInt32BE(at);
  return stamp;
}

/** A node key: a fixed one from `privateKeyHex`, else a random one. */
export function sphinxKey(privateKeyHex?: string) {
  const priv = privateKeyHex ? Buffer.from(privateKeyHex, "hex") : Buffer.from(utils.randomPrivateKey());
  return { priv, pubkey: Buffer.from(getPublicKey(priv, true)).toString("hex") };
}

/** The 65-byte signature (27 + recovery, then r ‖ s) over the Lightning prefix and `payload`. */
export async function signLightning(priv: Uint8Array, payload: Uint8Array): Promise<Buffer> {
  const message = Buffer.concat([Buffer.from("Lightning Signed Message:"), Buffer.from(payload)]);
  const signed = await signAsync(sha256(sha256(message)), priv);
  return Buffer.concat([Buffer.from([27 + signed.recovery]), Buffer.from(signed.toCompactRawBytes())]);
}

/** The bare token: a signature over the timestamp alone. */
export async function bareSphinxToken(priv: Uint8Array, at = nowSeconds()): Promise<string> {
  const stamp = timestampBytes(at);
  return Buffer.concat([stamp, await signLightning(priv, stamp)]).toString("base64");
}

/** The bound token: the same wire shape, the signature over host, purpose and challenge too. */
export async function boundSphinxToken(priv: Uint8Array, binding: SphinxTokenBinding, at = nowSeconds()): Promise<string> {
  const stamp = timestampBytes(at);
  return Buffer.concat([stamp, await signLightning(priv, sphinxTokenBoundPayload(binding, stamp))]).toString("base64");
}

/** Hive's host as the routes rebuild it in a test: NEXTAUTH_URL's (`sphinxTokenHost`). */
export const testHiveHost = () => new URL(process.env.NEXTAUTH_URL || "http://localhost:3000").host;
