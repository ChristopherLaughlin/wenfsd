/* wenFSD — optional live-data bridge.
 * When the dashboard is SERVED BY the backend (http/https), this hydrates the fleet
 * tracker, stats and feed from the real API and re-renders. When opened as a local
 * file:// demo (or if the API is unreachable), it does nothing — the seed data stands.
 * Fully guarded: any failure leaves the working demo untouched.
 */
(function () {
  if (!/^https?:$/.test(location.protocol)) return;   // file:// demo → skip

  function guessTag(text) {
    const t = String(text).toLowerCase();
    if (/fsd|full self|autopilot|autosteer/.test(t)) return "FSD";
    if (/fix|bug|stability|reliab/.test(t)) return "Fix";
    if (/safety|blind spot|collision/.test(t)) return "Safety";
    if (/nav|trip|route|charg/.test(t)) return "Nav";
    if (/ui|interface|display|theme/.test(t)) return "UI";
    return "Dashcam";
  }

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

    // --- REAL fleet firmware (from our own DB only — never the sample/merged data) ---
    // Only flips to "live" (and shows the fleet sections) when real crowdsourced data exists.
    try {
      const fw = await getJSON("/api/fleet/firmware");   // DB-backed, not the sample merge
      const versions = fw.versions;
      if (fw.source === "db" && Array.isArray(versions) && versions.length) {
        WEN.dataMode = "live";
        WEN.versions = versions.map(row => ({
          version: row.version,
          firstSeen: row.first_seen ? String(row.first_seen).slice(0, 10) : WEN.today,
          fleetPct: row.fleet_pct != null ? row.fleet_pct : null,
          branch: row.branch || "standard",
          status: row.status || "rolling",
          k: row.k || 0.33,
          t0: row.t0 ? String(row.t0).slice(0, 10) : (row.first_seen ? Predict.isoDay(Predict.addDays(String(row.first_seen).slice(0, 10), 10)) : WEN.today),
          fsdBuild: { AI4: "—", AI3: "—" },
          notes: "",
        }));
      }
    } catch (e) { /* no real data → stays sample → fleet sections hidden */ }

    // --- real fleet stats (DB counts) ---
    try {
      const s = await getJSON("/api/stats");
      if (s && s.mode === "live") {
        WEN.stats = { carsTracked: +s.cars_tracked || 0, auCars: +s.au_cars || 0, updatesLogged: +s.updates_logged || 0, versionsTracked: +s.versions_tracked || 0, releases2026: 0 };
      }
    } catch (e) { /* keep */ }

    // --- real live feed (DB version-change events) ---
    try {
      const fd = await getJSON("/api/fleet/feed");
      if (fd && fd.source === "db" && Array.isArray(fd.feed) && fd.feed.length) {
        WEN.feedSeeds = fd.feed.map(f => ({ region: f.region || "—", model: f.model || "Tesla", hw: f.hw || "AI4", from: f.from || "—", to: f.to || f.version || "—" }));
      }
    } catch (e) { /* keep */ }

    if (window.WENFSD && window.WENFSD.rerender) window.WENFSD.rerender();

    // --- pull the signed-in owner's Tesla-linked vehicles into the garage ---
    try {
      const r = await fetch("/api/me/vehicles", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      let vehicles = [];
      if (r.ok) { const d = await r.json(); vehicles = d.vehicles || []; }
      if (window.WENFSD && window.WENFSD.setLinkState) window.WENFSD.setLinkState({ status: r.status, vehicles });
    } catch (e) { /* ignore */ }

    console.info("[wenFSD] hydrated from live API (source: " + (health.mock ? "mock backend" : "database") + ")");
  }

  // run after app.js has booted
  if (document.readyState === "complete") hydrate();
  else window.addEventListener("load", hydrate);
})();
