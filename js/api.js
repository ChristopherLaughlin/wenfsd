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
    // bail quietly unless the backend is actually present (health endpoint is at /healthz)
    let health;
    try { health = await getJSON("/healthz"); } catch { return; }
    if (!health || !health.ok) return;

    // --- PRIORITY: pull the owner's linked vehicles into the garage FIRST, so nothing else
    // (a render glitch, a slow fetch) can ever block it ---
    try {
      const r = await fetch("/api/me/vehicles", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      let vehicles = [];
      if (r.ok) { const d = await r.json(); vehicles = d.vehicles || []; }
      if (window.WENFSD && window.WENFSD.setLinkState) window.WENFSD.setLinkState({ status: r.status, vehicles });
    } catch (e) { /* ignore */ }

    // --- REAL fleet firmware ---
    // Prefer our own crowdsourced DB. If that's empty (early days), fall back to the LIVE
    // tracker-aggregated merge (real version distribution scraped from the public trackers).
    // Either path flips dataMode → "live" and replaces the sample distribution with real data.
    function isoT0(firstSeen) {
      const fs = firstSeen ? String(firstSeen).slice(0, 10) : null;
      return fs ? Predict.isoDay(Predict.addDays(fs, 10)) : WEN.today;
    }
    try {
      const fw = await getJSON("/api/fleet/firmware");   // DB-backed
      const dbRows = fw.source === "db" && Array.isArray(fw.versions) ? fw.versions : [];
      if (dbRows.length) {
        WEN.dataMode = "live";
        WEN.versions = dbRows.map(row => ({
          version: row.version,
          firstSeen: row.first_seen ? String(row.first_seen).slice(0, 10) : WEN.today,
          fleetPct: row.fleet_pct != null ? row.fleet_pct : null,
          branch: row.branch || "standard",
          status: row.status || "rolling",
          k: row.k || 0.33,
          t0: row.t0 ? String(row.t0).slice(0, 10) : isoT0(row.first_seen),
          fsdBuild: { AI4: "—", AI3: "—" },
          notes: "",
        }));
      } else {
        const mg = await getJSON("/api/fleet/firmware?merged=1&live=1");
        const rows = Array.isArray(mg.versions) ? mg.versions.filter(r => r.fleetPct != null || r.firstSeen) : [];
        if (mg.mode === "live" && rows.length) {
          WEN.dataMode = "live";
          WEN.versions = rows.map(row => ({
            version: row.version,
            firstSeen: row.firstSeen ? String(row.firstSeen).slice(0, 10) : null,
            fleetPct: row.fleetPct != null ? row.fleetPct : null,
            branch: row.branch || "standard",
            status: row.status || "rolling",
            k: 0.33,
            t0: isoT0(row.firstSeen),
            fsdBuild: row.fsdBuild || { AI4: "—", AI3: "—" },
            notes: "",
            recentInstalls: row.recentInstalls != null ? row.recentInstalls : null,
            sources: row.sources || [],
            regions: Array.isArray(row.regions) ? row.regions : [],
          }));
        }
      }
    } catch (e) { /* no real data → stays sample */ }

    // --- source attribution strip (who we aggregated + live status) ---
    try {
      const sc = await getJSON("/api/sources?live=1");
      if (sc && Array.isArray(sc.sources) && window.WENFSD && window.WENFSD.setSources) {
        window.WENFSD.setSources(sc.sources, sc.mode === "live");
      }
    } catch (e) { /* keep default attribution */ }

    // --- REAL release notes (scraped per-version from Teslascope) ---
    try {
      const rn = await getJSON("/api/release-notes?live=1");
      if (rn && rn.mode === "live" && rn.notes && Object.keys(rn.notes).length) {
        WEN.releaseNotes = rn.notes;          // replace seed notes with the real ones
        WEN.releaseNotesSource = "live";
      }
    } catch (e) { /* keep seed notes (badged as modelled) */ }

    // --- real fleet stats (DB counts) ---
    try {
      const s = await getJSON("/api/stats");
      if (s && s.mode === "live") {
        WEN.stats = { carsTracked: +s.cars_tracked || 0, auCars: +s.au_cars || 0, updatesLogged: +s.updates_logged || 0, versionsTracked: +s.versions_tracked || 0, releases2026: 0 };
      }
    } catch (e) { /* keep */ }

    // (The "Recent rollout activity" feed is derived client-side from the real version data
    //  loaded above — no separate fabricated per-car feed.)

    // --- model calibration / back-test against real tracker history ---
    try {
      const cal = await getJSON("/api/calibration?live=1");
      if (cal && cal.mode === "live" && window.WENFSD && window.WENFSD.setCalibration) {
        window.WENFSD.setCalibration(cal);
      }
    } catch (e) { /* keep placeholder */ }

    try { if (window.WENFSD && window.WENFSD.rerender) window.WENFSD.rerender(); } catch (e) { console.warn("[wenFSD] rerender failed:", e && e.message); }

    console.info("[wenFSD] hydrated from live API (source: " + (health.mock ? "mock backend" : "database") + ")");
  }

  // run after app.js has booted
  if (document.readyState === "complete") hydrate();
  else window.addEventListener("load", hydrate);
})();
