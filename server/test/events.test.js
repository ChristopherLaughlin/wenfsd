import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEvent, FUNNEL_EVENTS } from "../src/routes/api.js";

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
