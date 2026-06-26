import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalMessage, deliver, resumeAlertMessage } from "../src/mailer.js";

test("resumeAlertMessage announces the resume with region + version + unsub, and stays honest", () => {
  const m = resumeAlertMessage({ version: "v14.x", region: "Australia", siteUrl: "https://wenfsd.info", unsubUrl: "https://wenfsd.info/api/unsubscribe?t=abc" });
  assert.match(m.subject, /rolling again/i);
  assert.match(m.subject, /Australia/);
  assert.match(m.subject, /v14\.x/);
  assert.match(m.text, /Australia/);
  assert.match(m.text, /prediction, not a Tesla promise/i, "stays honest — no fabricated certainty");
  assert.match(m.text, /unsubscribe\?t=abc/, "one-click off");
});

test("resumeAlertMessage degrades gracefully with no version/region", () => {
  const m = resumeAlertMessage({ siteUrl: "https://wenfsd.info", unsubUrl: "https://wenfsd.info/u" });
  assert.match(m.subject, /rolling again/i);
  assert.ok(m.text.length > 40);
});

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

test("deliver() is a safe no-op when nothing is configured (never throws, never blocks the poller)", async () => {
  const res = await deliver({ to: "a@b.com", subject: "x", text: "y", event: { type: "update_landed" } });
  assert.equal(res.delivered, false);
  assert.equal(res.channel, "none");
});

test("deliver() sends via the Resend API when configured (right endpoint, auth, payload)", async () => {
  const { config } = await import("../src/config.js");
  const saved = { k: config.resendApiKey, f: config.notifyFromEmail }, origFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => { captured = { url, opts }; return { ok: true }; };
  try {
    config.resendApiKey = "re_test123"; config.notifyFromEmail = "wenFSD <updates@wenfsd.info>";
    const res = await deliver({ to: "owner@example.com", subject: "🚗 update landed", text: "body" });
    assert.equal(res.delivered, true);
    assert.equal(res.channel, "resend");
    assert.equal(captured.url, "https://api.resend.com/emails");
    assert.match(captured.opts.headers.Authorization, /^Bearer re_test123$/);
    const body = JSON.parse(captured.opts.body);
    assert.deepEqual(body.to, ["owner@example.com"]);
    assert.equal(body.from, "wenFSD <updates@wenfsd.info>");
    assert.equal(body.subject, "🚗 update landed");
  } finally {
    globalThis.fetch = origFetch; config.resendApiKey = saved.k; config.notifyFromEmail = saved.f;
  }
});
