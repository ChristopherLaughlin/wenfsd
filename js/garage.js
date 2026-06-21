/* wenFSD — garage: persistent multi-vehicle store (localStorage)
 * This is the "add your own vehicles" layer. Each vehicle carries enough to drive a
 * prediction, plus an optional update history we use to ESTIMATE the car's rollout
 * percentile from real dates (instead of a guessed slider). The backend will later
 * populate history automatically from the Tesla Fleet API.
 */
const Garage = (function () {
  const KEY = "wenfsd.garage.v1";

  function load() {
    let state = null;
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem("wenfsd.garage"); // migrate legacy key
      if (raw) state = JSON.parse(raw);
    } catch (e) { return null; }
    if (!state || !Array.isArray(state.vehicles)) return null;
    // normalize each vehicle so older/partial saved data can't break the app
    state.vehicles = state.vehicles.map(normalize).filter(Boolean);
    if (!state.vehicles.find(v => v.id === state.activeId)) state.activeId = state.vehicles[0] ? state.vehicles[0].id : null;
    return state;
  }
  function normalize(v) {
    if (!v || typeof v !== "object") return null;
    v.id = v.id || uid();
    v.model = v.model || "Tesla";
    v.year = +v.year || 2026;
    v.hardware = v.hardware || "AI4";
    v.market = (WEN.regions && WEN.regions[v.market]) ? v.market : "Australia";
    v.drive = v.drive || "RHD";
    v.installedVersion = v.installedVersion || (WEN.versions[0] && WEN.versions[0].version) || "2026.14.6";
    v.earliness = Number.isFinite(+v.earliness) ? Math.min(0.97, Math.max(0.03, +v.earliness)) : 0.5;
    v.earlinessSource = v.earlinessSource || "default";
    v.earlyAccess = !!v.earlyAccess;
    v.optedIn = !!v.optedIn;
    v.history = Array.isArray(v.history) ? v.history.filter(h => h && h.version && h.date) : [];
    return v;
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // Optional demo car — loaded only when the user clicks "try a demo car", never automatically.
  function demoVehicle() {
    return {
      id: uid(),
      nickname: "Demo Model Y",
      vin: "",
      model: WEN.carPreset.model,
      year: WEN.carPreset.year,
      generation: "Juniper",
      hardware: WEN.carPreset.hardware,
      market: WEN.carPreset.market,
      drive: WEN.carPreset.drive,
      installedVersion: WEN.carPreset.installedVersion,
      fsdVersion: WEN.carPreset.fsdVersion,
      earliness: WEN.carPreset.earlinessPercentile,
      earlinessSource: "default",
      updateChannel: WEN.carPreset.updateChannel,
      earlyAccess: WEN.carPreset.earlyAccess,
      optedIn: false,
      history: [],
    };
  }
  function loadDemo() { const s = get(); const v = demoVehicle(); s.vehicles.push(v); s.activeId = v.id; save(s); return s; }

  // Default state is EMPTY — the user adds their own vehicles.
  function get() { return load() || { vehicles: [], activeId: null }; }
  function isEmpty() { return get().vehicles.length === 0; }

  function active(state) {
    state = state || get();
    return state.vehicles.find(v => v.id === state.activeId) || state.vehicles[0] || null;
  }

  function setActive(id) { const s = get(); s.activeId = id; save(s); return s; }

  function add(vehicle) {
    const s = get();
    // dedupe by VIN — re-adding the same VIN updates the existing entry instead of cloning
    const vin = (vehicle.vin || "").trim().toUpperCase();
    if (vin) {
      const existing = s.vehicles.find(v => (v.vin || "").toUpperCase() === vin);
      if (existing) { Object.assign(existing, vehicle, { id: existing.id, history: existing.history || [] }); s.activeId = existing.id; save(s); return s; }
    }
    vehicle.id = uid();
    if (vehicle.earliness == null) vehicle.earliness = 0.5;
    vehicle.earlinessSource = vehicle.earlinessSource || "default";
    vehicle.history = vehicle.history || [];
    s.vehicles.push(vehicle);
    s.activeId = vehicle.id;
    save(s);
    return s;
  }

  function clearAll() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } return { vehicles: [], activeId: null }; }

  function update(id, patch) {
    const s = get();
    const v = s.vehicles.find(x => x.id === id);
    if (v) Object.assign(v, patch);
    save(s);
    return s;
  }

  function remove(id) {
    const s = get();
    s.vehicles = s.vehicles.filter(v => v.id !== id);
    if (s.activeId === id) s.activeId = s.vehicles.length ? s.vehicles[0].id : null;
    save(s);
    return s;
  }

  /* Estimate rollout percentile from real update history.
   * For each logged update we compute days-after-first-seen of that version, then map
   * the average delay onto a percentile via the same logistic the predictor uses.
   * Returns { earliness, n } or null if not enough dated history. */
  function estimateEarliness(vehicle) {
    const hist = (vehicle.history || []).filter(h => h.version && h.date);
    if (hist.length < 1) return null;
    const delays = [];
    for (const h of hist) {
      const ver = WEN.versions.find(v => v.version === h.version);
      if (!ver) continue;
      // measure delay relative to the rollout MIDPOINT (t0), not first-seen:
      // adoption(t) = L/(1+e^{-k(t-t0)}), so the percentile you land at is exactly
      // p = 1/(1+e^{-k(t-t0)}). Getting it before t0 ⇒ p<0.5 (early), after ⇒ late.
      const delay = (new Date(h.date + "T00:00:00Z") - new Date(ver.t0 + "T00:00:00Z")) / 86400000;
      if (isFinite(delay)) delays.push({ delay, k: ver.k });
    }
    if (!delays.length) return null;
    let sum = 0;
    for (const d of delays) sum += 1 / (1 + Math.exp(-d.k * d.delay));
    const p = Math.min(0.97, Math.max(0.03, sum / delays.length));
    return { earliness: p, n: delays.length };
  }

  function uid() {
    // no Date.now()/Math.random dependency issues in browser, but keep it simple
    return "v" + Math.abs((Date.now() ^ (Math.random() * 1e9)) | 0).toString(36);
  }

  return { get, save, active, setActive, add, update, remove, clearAll, estimateEarliness, isEmpty, loadDemo };
})();
