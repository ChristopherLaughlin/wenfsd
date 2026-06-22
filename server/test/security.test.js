// Security-focused integration tests around the two things that protect Tesla owners:
//   (1) OAuth tokens are encrypted at rest and tamper-evident, and
//   (2) the OAuth authorize flow is PKCE + state, read-only, and never leaks the client secret.
// These guard the highest-blast-radius surface (a leaked token = access to someone's vehicle data),
// so a regression here should fail CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// the encryption key must be set BEFORE config.js loads (it reads process.env at import time)
process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { encrypt, decrypt, keyConfigured } = await import("../src/crypto.js");
const { config } = await import("../src/config.js");
const tesla = await import("../src/tesla.js");

// ---------------- token-at-rest encryption ----------------

test("a configured key is detected", () => {
  assert.equal(keyConfigured(), true);
});

test("tokens round-trip through AES-256-GCM and are not stored in the clear", () => {
  const token = "fake-tesla-access-token-abc123";
  const enc = encrypt(token);
  assert.ok(enc.startsWith("v1:"), "stored format is versioned");
  assert.ok(!enc.includes(token), "plaintext must not appear in the stored blob");
  assert.equal(enc.split(":").length, 4, "v1:iv:tag:ciphertext");
  assert.equal(decrypt(enc), token, "round-trips back to the original");
});

test("encryption is non-deterministic (random IV per call)", () => {
  const a = encrypt("same-token"), b = encrypt("same-token");
  assert.notEqual(a, b, "identical plaintext must not produce identical ciphertext");
  assert.equal(decrypt(a), decrypt(b));
});

test("tampering with the ciphertext is detected (GCM auth tag) and refuses to decrypt", () => {
  const enc = encrypt("sensitive-refresh-token");
  const parts = enc.split(":");
  // flip the last char of the ciphertext segment
  const ct = parts[3];
  parts[3] = ct.slice(0, -1) + (ct.slice(-1) === "A" ? "B" : "A");
  assert.throws(() => decrypt(parts.join(":")), "a tampered blob must throw, never return garbage");
});

test("null tokens stay null; legacy plaintext passes through decrypt untouched", () => {
  assert.equal(encrypt(null), null);
  assert.equal(decrypt(null), null);
  assert.equal(decrypt("not-encrypted-legacy-value"), "not-encrypted-legacy-value");
});

test("an invalid key length is rejected loudly (no silent weak-key fallback)", () => {
  const saved = config.tokenEncKey;
  try {
    config.tokenEncKey = Buffer.from("too-short").toString("base64");
    assert.throws(() => encrypt("x"), /32 bytes/);
  } finally {
    config.tokenEncKey = saved;
  }
});

// ---------------- OAuth authorize flow ----------------

test("PKCE challenge is the correct S256 hash of the verifier", () => {
  const { verifier, challenge } = tesla.makePkce();
  assert.ok(verifier && challenge);
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, expected, "challenge must be base64url(sha256(verifier))");
});

test("state tokens are random and unique (CSRF defence)", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const s = tesla.randomState();
    assert.match(s, /^[a-f0-9]{32}$/, "128-bit hex state");
    assert.ok(!seen.has(s), "states must not repeat");
    seen.add(s);
  }
});

test("the authorize URL is well-formed PKCE and never carries the client secret", () => {
  config.tesla.clientId = config.tesla.clientId || "test-client-id";
  const url = tesla.buildAuthUrl({ state: "STATE123", codeChallenge: "CHAL456" });
  const u = new URL(url);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge"), "CHAL456");
  assert.equal(u.searchParams.get("state"), "STATE123");
  assert.ok(u.searchParams.get("scope"), "a scope is requested");
  assert.ok(u.searchParams.get("redirect_uri"), "a redirect_uri is set");
  // the secret must NEVER appear in a browser-bound URL
  const secret = config.tesla.clientSecret || "should-not-leak";
  assert.ok(!url.includes("client_secret"), "no client_secret param in the authorize URL");
  assert.ok(!url.includes(secret), "the secret value must not appear anywhere in the URL");
});

test("the requested OAuth scope is read-only (no vehicle command/control scope)", () => {
  const scopes = config.tesla.scopes.toLowerCase();
  // a stolen read token can read vehicle data — serious — but must not be able to send commands
  for (const cmd of ["vehicle_cmds", "vehicle_commands", "vehicle_charging_cmds"]) {
    assert.ok(!scopes.includes(cmd), `must not request command scope: ${cmd}`);
  }
});
