// Guards against client/server data drift: the client js/data.js must match the canonical
// shared/wenmodel.json (which the server loads directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const MODEL = JSON.parse(readFileSync(path.join(ROOT, "shared", "wenmodel.json"), "utf8"));

function loadClientWEN() {
  const code = readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code + "\n;globalThis.__WEN = WEN;", ctx);
  return ctx.__WEN;
}

const WEN = loadClientWEN();
// round-trip through JSON so cross-realm (vm) objects compare by structure, not prototype
const J = (x) => JSON.parse(JSON.stringify(x));
const pick = (v) => J({ version: v.version, firstSeen: v.firstSeen, fleetPct: v.fleetPct, status: v.status, branch: v.branch, k: v.k, t0: v.t0, fsdBuild: v.fsdBuild });

test("client today + earlyAccessShift match canonical model", () => {
  assert.equal(WEN.today, MODEL.today);
  assert.equal(WEN.earlyAccessShift, MODEL.earlyAccessShift);
});

test("client versions match canonical model", () => {
  assert.deepEqual(J(WEN.versions.map(pick)), MODEL.versions.map(pick));
});

test("client regions match canonical model", () => {
  assert.deepEqual(J(WEN.regions), MODEL.regions);
});

test("client versionHistory matches canonical model (the back-test input)", () => {
  assert.deepEqual(J(WEN.versionHistory || []), MODEL.versionHistory || []);
});
