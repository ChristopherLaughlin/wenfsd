/* wenFSD — optional live-data bridge.
 * When the dashboard is SERVED BY the backend (http/https), this hydrates the fleet
 * tracker, stats and feed from the real API and re-renders. When opened as a local
 * file:// demo (or if the API is unreachable), it does nothing — the seed data stands.
 * Fully guarded: any failure leaves the working demo untouched.
 */
(function () {
  if (!/^https?:$/.test(location.protocol)) return;   // file:// demo → skip

  async function getJSON(path) {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }

  async function hydrate() {
    // bail quietly unless the backend is actually present
    let health;
    try { health = await getJSON("/api/healthz"); } catch { return; }
    if (!health || !health.ok) return;

    // --- firmware versions (merge live numbers onto existing display fields) ---
    try {
      const { versions } = await getJSON("/api/fleet/firmware");
      if (Array.isArray(versions) && versions.length) {
        const byVer = new Map(WEN.versions.map(v => [v.version, v]));
        WEN.versions = versions.map(row => {
          const prev = byVer.get(row.version) || {};
          return Object.assign({
            fsdBuild: prev.fsdBuild || { AI4: "—", AI3: "—", HW3: "—" },
            notes: prev.notes || "",
            status: prev.status || row.status || "rolling",
            k: prev.k || row.k || 0.33,
            t0: prev.t0 || (row.t0 ? String(row.t0).slice(0, 10) : WEN.today),
          }, {
            version: row.version,
            firstSeen: (row.first_seen ? String(row.first_seen).slice(0, 10) : prev.firstSeen) || WEN.today,
            fleetPct: row.fleet_pct != null ? Math.round(row.fleet_pct * 10) / 10 : prev.fleetPct,
            branch: row.branch || prev.branch || "standard",
          });
        });
      }
    } catch (e) { /* keep seed */ }

    // --- fleet stats ---
    try {
      const s = await getJSON("/api/stats");
      WEN.stats = {
        carsTracked: +s.cars_tracked || WEN.stats.carsTracked,
        auCars: +s.au_cars || WEN.stats.auCars,
        updatesLogged: +s.updates_logged || WEN.stats.updatesLogged,
        versionsTracked: +s.versions_tracked || WEN.stats.versionsTracked,
        releases2026: WEN.stats.releases2026,
      };
    } catch (e) { /* keep seed */ }

    // --- live feed ---
    try {
      const { feed } = await getJSON("/api/fleet/feed");
      if (Array.isArray(feed) && feed.length) {
        WEN.feedSeeds = feed.map(f => ({
          region: f.region || "—", model: f.model || "Tesla", hw: f.hw || "AI4",
          from: f.from || "—", to: f.to || f.version || "—",
        }));
      }
    } catch (e) { /* keep seed */ }

    if (window.WENFSD && window.WENFSD.rerender) window.WENFSD.rerender();
    console.info("[wenFSD] hydrated from live API (source: " + (health.mock ? "mock backend" : "database") + ")");
  }

  // run after app.js has booted
  if (document.readyState === "complete") hydrate();
  else window.addEventListener("load", hydrate);
})();
