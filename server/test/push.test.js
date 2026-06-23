import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidSubscription, runPushAlerts } from "../src/push.js";
import { pushEnabled } from "../src/config.js";

const goodSub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "BPk...key", auth: "authsecret" } };

test("isValidSubscription accepts a well-formed PushSubscription", () => {
  assert.equal(isValidSubscription(goodSub), true);
});

test("isValidSubscription rejects junk / non-https / oversized / missing keys", () => {
  for (const bad of [
    null, {}, "string", 42,
    { endpoint: "http://insecure/x", keys: { p256dh: "a", auth: "b" } },          // not https
    { endpoint: "https://x/" + "a".repeat(1100), keys: { p256dh: "a", auth: "b" } }, // too long
    { endpoint: "https://x/y", keys: { p256dh: "a" } },                            // missing auth
    { endpoint: "https://x/y", keys: { p256dh: "a".repeat(300), auth: "b" } },     // key too long
  ]) assert.equal(isValidSubscription(bad), false, `${JSON.stringify(bad).slice(0, 50)} must be rejected`);
});

test("push is dormant by default (no VAPID env) and runPushAlerts no-ops", async () => {
  assert.equal(pushEnabled(), false, "push disabled without VAPID keys");
  const r = await runPushAlerts();
  assert.equal(r.sent, 0);
  assert.equal(r.disabled, true);
});
