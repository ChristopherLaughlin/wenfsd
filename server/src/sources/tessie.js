// Source adapter: Tessie public software tracker (https://stats.tessie.com/)
// Largest fleet of the trackers (~630k vehicles) → gets the most merge weight.
// LIVE strategy: Tessie publishes the stats page; check for a JSON endpoint behind it,
// otherwise request partner access or parse if permitted.
export const tessie = {
  name: "Tessie",
  homepage: "https://stats.tessie.com/",
  fleet: 629503,
  hardwareAware: false,
  regionAware: false,
  async fetch({ live = false } = {}) {
    if (live) return fetchLive();
    return [
      { version: "2026.20", fleetPct: 34.2, firstSeen: "2026-06-10", branch: "standard", status: "tapering" },
      { version: "2026.14.6", fleetPct: 27.2, firstSeen: "2026-05-22", branch: "standard", status: "tapering" },
      { version: "2026.14.6.11", fleetPct: 15.0, firstSeen: "2026-06-05", branch: "standard", status: "rolling" },
      { version: "2026.20.3", fleetPct: 7.9, firstSeen: "2026-06-17", branch: "standard", status: "rolling" },
    ];
  },
};
async function fetchLive() { throw new Error("Tessie live fetch not wired — see adapter notes."); }
