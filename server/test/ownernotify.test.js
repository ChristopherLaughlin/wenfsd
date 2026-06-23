import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerAlertMessage, notifyOwnerOfPending } from "../src/ownernotify.js";

test("ownerAlertMessage summarises the event with a review link", () => {
  const m = ownerAlertMessage({ type: "pause", version: "2026.20.3", region: "Australia", source: "community-report", reason: "unforeseen issues" });
  assert.match(m.subject, /PAUSE/);
  assert.match(m.subject, /2026\.20\.3/);
  assert.match(m.subject, /Australia/);
  assert.match(m.text, /\/admin/);
  assert.match(m.text, /Nothing changes for users until you confirm/);
  assert.match(m.text, /unforeseen issues/);
});

test("ownerAlertMessage handles a global, version-less event", () => {
  const m = ownerAlertMessage({ type: "halt", source: "observed-plateau" });
  assert.match(m.subject, /HALT/);
  assert.match(m.subject, /next build/);
  assert.match(m.subject, /global/);
});

test("notifyOwnerOfPending no-ops safely when no channel is configured", async () => {
  // no NOTIFY_WEBHOOK_URL / OWNER_EMAIL in the test env → returns both-false, never throws
  const r = await notifyOwnerOfPending({ type: "pause", version: "2026.20.3", region: "Australia", source: "admin" });
  assert.equal(r.webhook, false);
  assert.equal(r.email, false);
});
