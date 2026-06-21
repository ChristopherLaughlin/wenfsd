// Source adapter: Teslascope (https://teslascope.com/software)
// LIVE strategy: Teslascope offers an API to subscribers/partners — prefer that.
// Otherwise a user export, or permitted parse of the public /software page.
export const teslascope = {
  name: "Teslascope",
  homepage: "https://teslascope.com/software",
  fleet: 120000,
  hardwareAware: true,
  regionAware: true,
  async fetch({ live = false } = {}) {
    if (live) return fetchLive();
    return [
      { version: "2026.20.3", fleetPct: 8.2, firstSeen: "2026-06-17", branch: "standard", fsd: { AI4: "v14.3.4" } },
      { version: "2026.14.6.11", fleetPct: 24.0, firstSeen: "2026-06-05", branch: "standard", fsd: { AI4: "v14.3.4" } },
      { version: "2026.14.6", fleetPct: 30.0, firstSeen: "2026-05-22", branch: "standard", fsd: { AI4: "v13.2.9" } },
      { version: "2026.20", fleetPct: 7.0, firstSeen: "2026-06-10", branch: "standard", fsd: { AI4: "v14.3.2" } },
    ];
  },
};
async function fetchLive() { throw new Error("Teslascope live fetch not wired — prefer their partner API."); }
