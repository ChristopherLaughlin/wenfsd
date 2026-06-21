// Source adapter: TeslaFi firmware tracker (https://teslafi.com/firmware.php)
// Normalizes to { version, fleetPct, firstSeen, branch }. `fleet` weights the merge.
//
// LIVE strategy (wire before launch, respecting ToS/robots.txt):
//   TeslaFi has no documented public API. Options, in order of preference:
//   1) Ask TeslaFi for a data-sharing/partner agreement (cleanest, ToS-safe).
//   2) A logged-in user's own export of their firmware data.
//   3) Parse the public firmware.php table — only if permitted by their ToS.
export const teslafi = {
  name: "TeslaFi",
  homepage: "https://teslafi.com/firmware.php",
  fleet: 13000,          // approx active cars (AI4 ~3.9k + AI3 ~8.1k + legacy)
  hardwareAware: true,   // TeslaFi segments by AI4/AI3/AI2.5
  regionAware: true,     // and by country
  async fetch({ live = false } = {}) {
    if (live) return fetchLive();
    return [
      { version: "2026.20.3", fleetPct: 10.4, firstSeen: "2026-06-17", branch: "standard" },
      { version: "2026.20", fleetPct: 23.1, firstSeen: "2026-06-10", branch: "standard" },
      { version: "2026.14.6.11", fleetPct: 22.0, firstSeen: "2026-06-05", branch: "standard" },
      { version: "2026.14.6", fleetPct: 28.0, firstSeen: "2026-05-22", branch: "standard" },
      { version: "2026.14.2", fleetPct: 9.5, firstSeen: "2026-05-08", branch: "standard" },
    ];
  },
};
async function fetchLive() { throw new Error("TeslaFi live fetch not wired — see adapter notes."); }
