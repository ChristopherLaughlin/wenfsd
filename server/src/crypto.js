// App-level encryption for secrets at rest (OAuth tokens).
// AES-256-GCM with a key from TOKEN_ENC_KEY (32 bytes, base64 or hex).
// Format stored in DB: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
import crypto from "node:crypto";
import { config } from "./config.js";

function loadKey() {
  const raw = config.tokenEncKey;
  if (!raw) return null;
  let key;
  if (/^[A-Fa-f0-9]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENC_KEY must decode to 32 bytes (got " + key.length + ").");
  return key;
}

export function encrypt(plaintext) {
  const key = loadKey();
  if (!key) return plaintext; // mock/dev with no key — store as-is (never do this in real mode)
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(stored) {
  const key = loadKey();
  if (!key || stored == null) return stored;
  if (typeof stored !== "string" || !stored.startsWith("v1:")) return stored; // legacy plaintext
  const [, ivB64, tagB64, ctB64] = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// Generate a key once:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
export function keyConfigured() { return !!loadKey(); }
