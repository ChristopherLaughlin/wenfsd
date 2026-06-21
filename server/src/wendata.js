/* wenFSD shared data model (server copy of js/data.js).
 * MUST stay in sync with the frontend's WEN object — same versions, regions, shifts.
 * In real mode these are overridden by DB-fitted values; this is the mock/seed baseline.
 */
export const today = "2026-06-21";
export const earlyAccessShift = -0.30;

export const versions = [
  { version: "2026.20.3", firstSeen: "2026-06-17", fleetPct: 9.8, status: "rolling", branch: "standard", k: 0.34, t0: "2026-06-27", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" } },
  { version: "2026.20", firstSeen: "2026-06-10", fleetPct: 6.1, status: "tapering", branch: "standard", k: 0.31, t0: "2026-06-20", fsdBuild: { AI4: "v14.3.2", AI3: "v12.6.4" } },
  { version: "2026.14.6.11", firstSeen: "2026-06-05", fleetPct: 24.4, status: "mature", branch: "standard", k: 0.36, t0: "2026-06-12", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" } },
  { version: "2026.14.6", firstSeen: "2026-05-22", fleetPct: 35.7, status: "mature", branch: "standard", k: 0.33, t0: "2026-06-01", fsdBuild: { AI4: "v13.2.9", AI3: "v12.6.4" } },
  { version: "2026.14.2", firstSeen: "2026-05-08", fleetPct: 11.3, status: "legacy", branch: "standard", k: 0.30, t0: "2026-05-18", fsdBuild: { AI4: "v13.2.8", AI3: "v12.6.3" } },
];

export const regions = {
  "United States": { osLagDays: 0, drive: "LHD", fsd: {
    AI4: { current: "v14.3.4", next: "v14.4.x", mode: "current", k: 0.16, cadenceDays: 28 },
    AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "rolling", k: 0.10, t0: "2026-07-05" } } },
  "Canada": { osLagDays: 3, drive: "LHD", fsd: {
    AI4: { current: "v14.3.2", next: "v14.3.4", mode: "rolling", k: 0.18, t0: "2026-06-26" },
    AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "gated", approval: { earliestDays: 10, modeDays: 35, latestDays: 80 }, k: 0.10 } } },
  "Europe": { osLagDays: 9, drive: "LHD", fsd: {
    AI4: { current: "v13.2.8", next: "v14.x", mode: "gated", approval: { earliestDays: 25, modeDays: 90, latestDays: 220 }, k: 0.09 },
    AI3: { current: "v12.6.4", next: null, mode: "capped" } } },
  "Australia": { osLagDays: 12, drive: "RHD", fsd: {
    AI4: { current: "v13.2.9", next: "v14.x", mode: "early", firstSeen: "2026-06-09", fleetPct: 5.4, k: 0.085, t0: "2026-07-14", t0Sigma: 7 },
    AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "gated", approval: { earliestDays: 5, modeDays: 30, latestDays: 75 }, k: 0.09 } } },
  "New Zealand": { osLagDays: 14, drive: "RHD", fsd: {
    AI4: { current: "v13.2.9", next: "v14.x", mode: "gated", approval: { earliestDays: 14, modeDays: 45, latestDays: 110 }, k: 0.08 },
    AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "gated", approval: { earliestDays: 14, modeDays: 50, latestDays: 120 }, k: 0.08 } } },
};

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
