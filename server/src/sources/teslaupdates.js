// Source adapter: Tesla Updates (https://teslaupdates.org/rollouts)
// Shows install calendar + "% of unified fleet" + pending counts per version.
export const teslaupdates = {
  name: "Tesla Updates",
  homepage: "https://teslaupdates.org/rollouts",
  fleet: 22000,
  hardwareAware: false,
  regionAware: true,   // "installed in N countries"
  async fetch({ live = false } = {}) {
    if (live) return fetchLive();
    return [
      { version: "2026.14.6", fleetPct: 33.4, firstSeen: "2026-05-22", branch: "standard" },
      { version: "2026.20.3", fleetPct: 6.6, firstSeen: "2026-06-17", branch: "standard" },
      { version: "2026.20", fleetPct: 18.0, firstSeen: "2026-06-10", branch: "standard" },
      { version: "2026.14.6.11", fleetPct: 20.0, firstSeen: "2026-06-05", branch: "standard" },
    ];
  },
};
async function fetchLive() { throw new Error("Tesla Updates live fetch not wired — see adapter notes."); }
