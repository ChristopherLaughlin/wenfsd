import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalMessage, deliver } from "../src/mailer.js";

test("arrivalMessage builds an on-brand, accurate subject + body", () => {
  const m = arrivalMessage({ nickname: "JuniperJoy", fromVersion: "2026.14.6", toVersion: "2026.20.3" });
  assert.match(m.subject, /JuniperJoy/);
  assert.match(m.subject, /2026\.20\.3/);
  assert.match(m.text, /2026\.14\.6/);
  assert.match(m.text, /2026\.20\.3/);
  assert.match(m.text, /turn it off|Turn it off/i, "explains how to opt out");
});

test("arrivalMessage falls back gracefully with no nickname (uses VIN tail, not the full VIN)", () => {
  const m = arrivalMessage({ vin: "7SAYGDEE8RF000123", toVersion: "2026.20.3" });
  assert.match(m.subject, /000123/);
  assert.ok(!m.subject.includes("7SAYGDEE8RF000123"), "must not leak the full VIN in the subject");
});

test("deliver() is a safe no-op when no webhook is configured (never throws, never blocks the poller)", async () => {
  // config.notifyWebhookUrl is unset in test env → log-only path
  const res = await deliver({ to: "a@b.com", subject: "x", text: "y", event: { type: "update_landed" } });
  assert.equal(res.delivered, false);
  assert.equal(res.channel, "none");
});
