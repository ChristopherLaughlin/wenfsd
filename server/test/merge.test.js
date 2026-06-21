import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, fetchAll, sourceStatus } from "../src/sources/index.js";

test("merge returns fleet-weighted versions sorted newest-first", async () => {
  const m = await merge({ live: false });
  assert.ok(m.length >= 4);
  // newest first
  assert.equal(m[0].version, "2026.20.3");
  // weighted % is a number within range
  for (const v of m) {
    if (v.fleetPct != null) assert.ok(v.fleetPct >= 0 && v.fleetPct <= 100);
    assert.ok(Array.isArray(v.sources));
  }
});

test("the top version aggregates multiple sources + has release notes", async () => {
  const m = await merge({ live: false });
  const top = m.find(v => v.version === "2026.20.3");
  assert.ok(top.sources.length >= 3);
  assert.ok(top.notes.length >= 1);
});

test("sourceStatus reports all adapters", async () => {
  const status = sourceStatus(await fetchAll({ live: false }));
  assert.equal(status.length, 5);
  assert.ok(status.every(s => s.ok));
});
