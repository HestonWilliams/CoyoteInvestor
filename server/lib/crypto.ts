import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * AES-256-GCM field-level encryption (PRD §11.1).
 *
 * Every sensitive value is encrypted at the application layer before it
 * hits Postgres. Neon (and any DB admin) must never see plaintext.
 *
 * Format on disk: `<iv_hex>:<tag_hex>:<ciphertext_hex>`
 *   - iv: 12-byte random nonce (unique per encryption)
 *   - tag: 16-byte GCM auth tag (integrity + authenticity)
 *   - ciphertext: raw encrypted bytes
 *
 * Key rotation: a new ENCRYPTION_KEY invalidates all existing ciphertexts.
 * For rotation, introduce a key-id prefix and keep the old key available for
 * decrypt-only. Phase 1 ships with a single active key.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate with: openssl rand -hex 32"
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes (64 hex chars); got ${buf.length} bytes.`
    );
  }
  cachedKey = buf;
  return buf;
}

export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext: expected iv:tag:data");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (iv.length !== IV_LEN) throw new Error("Malformed IV length");
  if (tag.length !== TAG_LEN) throw new Error("Malformed auth tag length");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Safe one-way hash for refresh-token storage (not for passwords). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** URL-safe random token (base64url). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
