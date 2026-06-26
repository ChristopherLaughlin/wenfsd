import { test } from "node:test";
import assert from "node:assert/strict";
import { detectModelDrift } from "../src/rolloutcheck.js";

const model = {
  today: "2026-06-26",
  versions: [
    { version: "2026.20.3", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" } },
    { version: "2026.16.6", fsdBuild: { AI4: "v14.3.3", AI3: "—" } },
  ],
};

test("flags a NEW OS build newer than the model's newest (>=0.5% fleet)", () => {
  const drift = detectModelDrift([{ version: "2026.22", fleetPct: 4.0, fsdBuild: null }], "2026-06-26", model);
  assert.ok(drift.some(d => d.kind === "new-build" && d.version === "2026.22"));
});

test("ignores a brand-new build with negligible fleet share (test-build noise)", () => {
  const drift = detectModelDrift([{ version: "2026.22", fleetPct: 0.1, fsdBuild: null }], "2026-06-26", model);
  assert.ok(!drift.some(d => d.kind === "new-build"));
});

test("ignores builds the model already knows", () => {
  const drift = detectModelDrift([{ version: "2026.20.3", fleetPct: 40, fsdBuild: { AI4: "v14.3.4" } }], "2026-06-26", model);
  assert.equal(drift.length, 0);
});

test("flags a NEW FSD version newer than the model carries for that hardware", () => {
  const drift = detectModelDrift([{ version: "2026.20.5", fleetPct: 0, fsdBuild: { AI4: "v14.4.1" } }], "2026-06-26", model);
  assert.ok(drift.some(d => d.kind === "new-fsd" && d.hardware === "AI4" && d.fsd === "v14.4.1"));
});

test("reports each new FSD version once, not per build that carries it", () => {
  const rows = [
    { version: "2026.20.5", fleetPct: 0, fsdBuild: { AI4: "v14.4.1" } },
    { version: "2026.20.6", fleetPct: 0, fsdBuild: { AI4: "v14.4.1" } },
  ];
  assert.equal(detectModelDrift(rows, "2026-06-26", model).filter(d => d.kind === "new-fsd").length, 1);
});

test("flags a stale 'today' anchor (>10 days behind real now)", () => {
  assert.ok(detectModelDrift([], "2026-07-20", model).some(d => d.kind === "stale-date"));
});

test("does not flag a fresh 'today' anchor", () => {
  assert.ok(!detectModelDrift([], "2026-06-30", model).some(d => d.kind === "stale-date"));
});

test("no drift when the live consensus matches the model", () => {
  const rows = [
    { version: "2026.20.3", fleetPct: 37, fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" } },
    { version: "2026.16.6", fleetPct: 0.2, fsdBuild: { AI4: "v14.3.3", AI3: "—" } },
  ];
  assert.equal(detectModelDrift(rows, "2026-06-28", model).length, 0);
});
