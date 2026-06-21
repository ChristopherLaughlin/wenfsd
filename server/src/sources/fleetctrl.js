// Source adapter: FleetCtrl (https://fleetctrl.app/)
// A changelog/release aggregator: version, release date, affected variants, FSD build,
// regional tags ("Down Under"), and a feature changelog. No fleet % — so it contributes
// release NOTES and first-seen dates rather than adoption weighting (fleet: 0).
export const fleetctrl = {
  name: "FleetCtrl",
  homepage: "https://fleetctrl.app/",
  fleet: 0,              // changelog source, not a fleet sample
  providesReleaseNotes: true,
  async fetch({ live = false } = {}) {
    if (live) return fetchLive();
    return [
      { version: "2026.20.3", firstSeen: "2026-06-17", branch: "standard", fsd: { AI4: "v14.3.4" }, regions: ["US", "EU", "Down Under"],
        notes: ["Dashcam Viewer timeline scrubbing", "Charging stats redesign", "Sentry Mode power optimisation", "FSD (Supervised) v14.3.4 for HW4"] },
      { version: "2026.20", firstSeen: "2026-06-10", branch: "standard", fsd: { AI4: "v14.3.2" }, regions: ["US", "EU"],
        notes: ["New trip planner", "Bluetooth stability fixes", "FSD (Supervised) v14.3.2 for HW4"] },
      { version: "2026.14.6.11", firstSeen: "2026-06-05", branch: "standard", fsd: { AI4: "v14.3.4" }, regions: ["US", "Down Under"],
        notes: ["Point fix on 14.6 branch", "Navigation reliability", "FSD v14.3.4 bundled for HW4"] },
      { version: "2026.14.6", firstSeen: "2026-05-22", branch: "standard", fsd: { AI4: "v13.2.9" }, regions: ["Global"],
        notes: ["Blind Spot camera improvements", "Media player UI", "FSD v13.2.9 for HW4"] },
    ];
  },
};
async function fetchLive() { throw new Error("FleetCtrl live fetch not wired — see adapter notes."); }
