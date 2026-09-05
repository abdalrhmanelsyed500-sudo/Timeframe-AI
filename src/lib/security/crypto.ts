import crypto from "node:crypto";
import { loadEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * AES-256-GCM envelope-ready credential encryption.
 * key_version is stored alongside every record so a future KMS/DEK rotation
 * can decrypt historical rows without a destructive migration.
 */
export const CURRENT_KEY_VERSION = 1;

export interface Sealed {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function masterKey(): Buffer {
  const env = loadEnv();
  if (!env.ENCRYPTION_KEY) {
    throw new AppError("CONFIGURATION_ERROR", "Credential encryption is not configured (ENCRYPTION_KEY missing).");
  }
  const raw = env.ENCRYPTION_KEY.trim();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw).digest();
  if (key.length !== 32) {
    throw new AppError("CONFIGURATION_ERROR", "ENCRYPTION_KEY must resolve to 32 bytes.");
  }
  return key;
}

export function seal(plaintext: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function open(sealed: Sealed): string {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new AppError("CONFIGURATION_ERROR", "Stored credential could not be decrypted.", { cause: e });
  }
}

export function isEncryptionConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** Never log or return a full key. */
export function lastFour(secret: string): string {
  return secret.slice(-4).padStart(4, "•");
}
