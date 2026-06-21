import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeVIN } from "../src/vin.js";

test("decodes a Shanghai-built 2026 Model Y", () => {
  const d = decodeVIN("LRWYGDEK8TC000123");
  assert.equal(d.valid, true);
  assert.equal(d.model, "Model Y");
  assert.equal(d.model_year, 2026);
  assert.equal(d.hardware, "AI4");
  assert.equal(d.market, "Australia");
  assert.equal(d.generation, "Juniper");
});

test("infers HW3 for an older Model Y", () => {
  const d = decodeVIN("5YJYGDEE9PF000001"); // P = 2023
  assert.equal(d.model, "Model Y");
  assert.equal(d.model_year, 2023);
  assert.equal(d.hardware, "AI3");
  assert.equal(d.market, "United States");
});

test("rejects a non-17-char VIN", () => {
  assert.equal(decodeVIN("TOOSHORT").valid, false);
});

test("normalises lowercase + spaces", () => {
  const d = decodeVIN(" lrwygdek8tc000123 ");
  assert.equal(d.valid, true);
  assert.equal(d.model, "Model Y");
});
