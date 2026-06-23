import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyIdToken } from "../src/tesla.js";

// build a JWT-shaped string with the given claims (signature is irrelevant — code-flow trust is
// the TLS back-channel; these tests cover the defence-in-depth claim checks)
const tok = (payload) => "h." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".sig";
const future = () => Math.floor(Date.now() / 1000) + 3600;

test("rejects a malformed id_token", async () => {
  await assert.rejects(() => verifyIdToken("nope"), /malformed/);
  await assert.rejects(() => verifyIdToken(""), /malformed/);
});

test("rejects an expired id_token", async () => {
  await assert.rejects(() => verifyIdToken(tok({ sub: "x", exp: 1000, iss: "https://auth.tesla.com/oauth2/v3" })), /expired/);
});

test("rejects an issuer that isn't a tesla.com domain", async () => {
  await assert.rejects(() => verifyIdToken(tok({ sub: "x", exp: future(), iss: "https://evil.example.com" })), /issuer/);
  await assert.rejects(() => verifyIdToken(tok({ sub: "x", exp: future(), iss: "https://auth.tesla.com.evil.com" })), /issuer/);
});

test("accepts a fresh token from a tesla.com issuer", async () => {
  const p = await verifyIdToken(tok({ sub: "abc123", email: "a@b.co", exp: future(), iss: "https://auth.tesla.com/oauth2/v3" }));
  assert.equal(p.sub, "abc123");
  assert.equal(p.email, "a@b.co");
});
