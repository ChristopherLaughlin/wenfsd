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

    // --- firmware versions + release notes (fleet-weighted consensus across trackers) ---
    try {
      const fw = await getJSON("/api/fleet/firmware?merged=1");
      const versions = fw.versions;
      if (fw.mode === "live") WEN.dataMode = "live";
      if (Array.isArray(versions) && versions.length) {
        const byVer = new Map(WEN.versions.map(v => [v.version, v]));
        WEN.versions = versions.map(row => {
          const prev = byVer.get(row.version) || {};
          // t0 is the rollout MIDPOINT, not first-seen. Prefer a real fitted t0 from the
          // backend; otherwise estimate midpoint ≈ first-seen + ~10 days (never first-seen).
          const fittedT0 = row.t0 ? String(row.t0).slice(0, 10) : null;
          const estT0 = row.firstSeen ? Predict.isoDay(Predict.addDays(String(row.firstSeen).slice(0, 10), 10)) : null;
          return Object.assign({
            notes: prev.notes || "",
            k: row.k || prev.k || 0.33,
            t0: fittedT0 || prev.t0 || estT0 || WEN.today,
          }, {
            version: row.version,
            firstSeen: (row.firstSeen ? String(row.firstSeen).slice(0, 10) : prev.firstSeen) || WEN.today,
            fleetPct: row.fleetPct != null ? row.fleetPct : prev.fleetPct,
            branch: row.branch || prev.branch || "standard",
            status: row.status || prev.status || "rolling",
            fsdBuild: Object.assign({ AI4: "—", AI3: "—" }, prev.fsdBuild, row.fsdBuild || {}),
          });
        });
        // ingest release notes from the merged tracker data
        for (const row of versions) {
          if (row.notes && row.notes.length) {
            WEN.releaseNotes[row.version] = {
              date: row.firstSeen ? String(row.firstSeen).slice(0, 10) : "",
              regions: row.regions || [],
              fsd: row.fsdBuild && row.fsdBuild.AI4 ? row.fsdBuild.AI4 + " (HW4)" : "—",
              source: (row.sources || []).join(", ") || "trackers",
              items: row.notes.map(t => ({ tag: guessTag(t), text: t })),
            };
          }
        }
      }
    } catch (e) { /* keep seed */ }

    // --- source attribution (live status) ---
    try {
      const { sources } = await getJSON("/api/sources");
      if (Array.isArray(sources) && sources.length && window.WENFSD && window.WENFSD.setSources) {
        window.WENFSD.setSources(sources, true);
      }
    } catch (e) { /* keep default */ }

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
