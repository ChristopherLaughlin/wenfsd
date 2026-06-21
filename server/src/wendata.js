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
export const regions = MODEL.regions;

export function parseOS(v) {
  const m = String(v).match(/^(\d{4})\.(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return { year: +m[1], week: +m[2], p1: m[3] ? +m[3] : 0, p2: m[4] ? +m[4] : 0 };
}
export function verKey(v) { const p = parseOS(v); return p ? p.year * 1e9 + p.week * 1e6 + p.p1 * 1e3 + p.p2 : 0; }
export function fsdMajor(v) { const m = String(v).match(/v?(\d+)/i); return m ? +m[1] : null; }

// effective rollout percentile (Early Access shifts you earlier; history overrides)
export function effEarliness(vehicle) {
  let e = vehicle.earliness != null ? vehicle.earliness : 0.5;
  if (vehicle.earlinessSource !== "history" && vehicle.earlyAccess) e += earlyAccessShift;
  return Math.min(0.97, Math.max(0.03, e));
}
