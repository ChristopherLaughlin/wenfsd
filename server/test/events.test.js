import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEvent, FUNNEL_EVENTS, isValidEmail } from "../src/routes/api.js";

test("email validation accepts plausible addresses", () => {
  for (const e of ["a@b.co", "juniper.joy@gmail.com", "x+tag@sub.domain.io"]) {
    assert.equal(isValidEmail(e), true, `${e} should be valid`);
  }
});

test("email validation rejects junk, injection, and over-long input", () => {
  for (const bad of ["", "notanemail", "no@domain", "@nodomain.com", "spaces in@x.com", "a@b.c\nBcc: evil@x.com", null, 42, "x".repeat(250) + "@y.com"]) {
    assert.equal(isValidEmail(bad), false, `${JSON.stringify(bad).slice(0, 40)} must be rejected`);
  }
});

test("email_subscribed is a tracked funnel event", () => {
  assert.equal(isValidEvent("email_subscribed"), true);
});

test("funnel event allowlist accepts the known events", () => {
  for (const e of ["prediction_generated", "connect_clicked", "email_subscribed", "shared", "bet_placed"]) {
    assert.equal(isValidEvent(e), true, `${e} should be allowed`);
  }
});

test("funnel event allowlist rejects unknown / malformed events", () => {
  for (const bad of ["", "drop table", "PREDICTION_GENERATED", "<script>", null, undefined, 42, {}, "prediction_generated "]) {
    assert.equal(isValidEvent(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test("allowlist is a Set of non-empty lowercase snake_case strings (no PII fields)", () => {
  assert.ok(FUNNEL_EVENTS instanceof Set && FUNNEL_EVENTS.size > 0);
  for (const e of FUNNEL_EVENTS) assert.match(e, /^[a-z][a-z_]*[a-z]$/, `${e} should be snake_case`);
});
