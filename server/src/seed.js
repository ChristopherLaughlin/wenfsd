// Mock-mode seed data so the backend runs end-to-end with no DB or Tesla credentials, served by the
// sample-mode /api/sources, /api/feed and /api/stats endpoints. SEED_VERSIONS is DERIVED from the
// canonical model (shared/wenmodel.json via wendata) so the server's sample firmware data can never
// drift from the client's predictions — a hardcoded copy here had gone stale after a data rebuild
// (it still listed removed builds like 2026.14.6.11). In real mode these come from Postgres instead.
import * as W from "./wendata.js";

export const SEED_VERSIONS = W.versions.map(v => ({
  version: v.version,
  branch: v.branch || "standard",
  first_seen: v.firstSeen,
  fleet_pct: v.fleetPct,
  t0: v.t0,
  k: v.k,
  status: v.status,
}));

// A small honest sample of recent "activity", built only from real builds in the model (no removed
// versions). Shown in sample mode behind a clear "mode: sample" flag.
export const SEED_FEED = [
  { region: "Sydney, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.20.3", minutes_ago: 0 },
  { region: "Melbourne, AU", model: "Model 3 Highland", hw: "AI4", from: "2026.2.6.5", to: "2026.20.3", minutes_ago: 3 },
  { region: "Brisbane, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.16.6", to: "2026.20.3", minutes_ago: 6 },
  { region: "Perth, AU", model: "Model S", hw: "AI3", from: "2026.2.6.5", to: "2026.20", minutes_ago: 11 },
];

export const SEED_STATS = { cars_tracked: 18432, au_cars: 6207, updates_logged: 312395, versions_tracked: 824 };
