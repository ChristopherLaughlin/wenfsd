import { test } from "node:test";
import assert from "node:assert/strict";
import { countryToRegion } from "../src/routes/api.js";

test("countryToRegion maps the markets we model", () => {
  assert.equal(countryToRegion("AU"), "Australia");
  assert.equal(countryToRegion("au"), "Australia");
  assert.equal(countryToRegion("NZ"), "New Zealand");
  assert.equal(countryToRegion("US"), "United States");
  assert.equal(countryToRegion("CA"), "Canada");
});

test("countryToRegion folds European countries into Europe", () => {
  for (const cc of ["GB", "DE", "FR", "NL", "SE"]) assert.equal(countryToRegion(cc), "Europe");
});

test("countryToRegion returns null for unknown / junk (client falls back to its own default)", () => {
  for (const cc of ["", null, "ZZ", "JP", "BR", 42, "X"]) assert.equal(countryToRegion(cc), null);
});
