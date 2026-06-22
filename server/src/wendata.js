/* wenFSD shared data model — loaded from the CANONICAL shared/wenmodel.json.
 * The client (js/data.js) is checked against the same JSON by server/test/parity.test.js,
 * so server and client cannot silently drift. In real mode, DB-fitted values override.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "shared", "wenmodel.json"), "utf8"));

export const today = MODEL.today;
export const earlyAccessShift = MODEL.earlyAccessShift;
export const versions = MODEL.versions;
export const versionHistory = MODEL.versionHistory || [];
export const regions = MODEL.regions;

export function parseOS(v) {
  const m = String(v).trim().match(/^(\d{4})((?:\.\d+){1,5})/);
  if (!m) return null;
  const parts = m[2].split(".").filter(s => s !== "").map(Number);
  return { year: +m[1], week: parts[0] || 0, p1: parts[1] || 0, p2: parts[2] || 0, p3: parts[3] || 0, parts };
}
export function verKey(v) {
  const p = parseOS(v); if (!p) return 0;
  const c = p.parts, g = (i, cap) => Math.min(cap, c[i] || 0);
  return p.year * 1e12 + g(0, 999) * 1e9 + g(1, 999) * 1e6 + g(2, 999) * 1e3 + g(3, 999);
}
export function fsdMajor(v) { const m = String(v).match(/v?(\d+)/i); return m ? +m[1] : null; }
// Full comparable key so "v14.3.5" > "v14.3.4" > "v13.2.9". "v14.x"/"v14 Lite" compare major-only.
export function fsdKey(v) {
  if (v == null) return 0;
  const s = String(v).toLowerCase();
  if (!/\d/.test(s)) return 0;
  const m = s.match(/v?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return 0;
  return (+m[1] || 0) * 1e9 + (+m[2] || 0) * 1e6 + (+m[3] || 0) * 1e3 + (+m[4] || 0);
}

// region build-path: which markets receive a build (default all); is a build in a region?
const ALL_MARKETS = Object.keys(regions);
export function marketsFor(v) { return Array.isArray(v.markets) && v.markets.length ? v.markets : ALL_MARKETS; }
export function inRegion(v, market) { return !market || marketsFor(v).includes(market); }

// effective rollout percentile (Early Access shifts you earlier; history overrides)
export function effEarliness(vehicle) {
  let e = vehicle.earliness != null ? vehicle.earliness : 0.5;
  if (vehicle.earlinessSource !== "history" && vehicle.earlyAccess) e += earlyAccessShift;
  if (vehicle.earlinessSource !== "history" && vehicle.newCar) e -= 0.12;
  return Math.min(0.97, Math.max(0.03, e));
}
