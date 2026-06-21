// Mock-mode seed data so the backend runs end-to-end with no DB or Tesla credentials.
// Mirrors the frontend's js/data.js. In real mode these come from Postgres instead.
export const SEED_VERSIONS = [
  { version: "2026.20.3", branch: "standard", first_seen: "2026-06-17", fleet_pct: 9.8, t0: "2026-06-27", k: 0.34, status: "rolling" },
  { version: "2026.20", branch: "standard", first_seen: "2026-06-10", fleet_pct: 6.1, t0: "2026-06-20", k: 0.31, status: "tapering" },
  { version: "2026.14.6.11", branch: "standard", first_seen: "2026-06-05", fleet_pct: 24.4, t0: "2026-06-12", k: 0.36, status: "mature" },
  { version: "2026.14.6", branch: "standard", first_seen: "2026-05-22", fleet_pct: 35.7, t0: "2026-06-01", k: 0.33, status: "mature" },
  { version: "2026.14.2", branch: "standard", first_seen: "2026-05-08", fleet_pct: 11.3, t0: "2026-05-18", k: 0.30, status: "legacy" },
];

export const SEED_FEED = [
  { region: "Sydney, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.20.3", minutes_ago: 0 },
  { region: "Melbourne, AU", model: "Model 3 Highland", hw: "AI4", from: "2026.14.6.11", to: "2026.20.3", minutes_ago: 3 },
  { region: "Brisbane, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.14.6.11", minutes_ago: 6 },
  { region: "Perth, AU", model: "Model S", hw: "AI3", from: "2026.14.2", to: "2026.14.6", minutes_ago: 11 },
];

export const SEED_STATS = { cars_tracked: 18432, au_cars: 6207, updates_logged: 312395, versions_tracked: 824 };

export const SEED_FSD = {
  branch_active: true, current_build: "v14.3.4 (AI4)", first_seen_au: "2026-06-09",
  fleet_pct: 5.4, k: 0.085, t0: "2026-07-14", t0_sigma: 7,
};
