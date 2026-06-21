/* wenFSD — garage: persistent multi-vehicle store (localStorage)
 * This is the "add your own vehicles" layer. Each vehicle carries enough to drive a
 * prediction, plus an optional update history we use to ESTIMATE the car's rollout
 * percentile from real dates (instead of a guessed slider). The backend will later
 * populate history automatically from the Tesla Fleet API.
 */
const Garage = (function () {
  const KEY = "wenfsd.garage.v1";

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // seed with the demo Juniper on first run so the dashboard isn't empty
  function seed() {
    const v = {
      id: uid(),
      nickname: "My Model Y",
      vin: "",
      model: WEN.carPreset.model,
      year: WEN.carPreset.year,
      hardware: WEN.carPreset.hardware,
      market: WEN.carPreset.market,
      drive: WEN.carPreset.drive,
      installedVersion: WEN.carPreset.installedVersion,
      fsdVersion: WEN.carPreset.fsdVersion,
      earliness: WEN.carPreset.earlinessPercentile,
      earlinessSource: "default",
      optedIn: false,
      history: [],
    };
    const state = { vehicles: [v], activeId: v.id };
    save(state);
    return state;
  }

  function get() { return load() || seed(); }

  function active(state) {
    state = state || get();
    return state.vehicles.find(v => v.id === state.activeId) || state.vehicles[0];
  }

  function setActive(id) { const s = get(); s.activeId = id; save(s); return s; }

  function add(vehicle) {
    const s = get();
    vehicle.id = uid();
    if (vehicle.earliness == null) vehicle.earliness = 0.5;
    vehicle.earlinessSource = vehicle.earlinessSource || "default";
    vehicle.history = vehicle.history || [];
    s.vehicles.push(vehicle);
    s.activeId = vehicle.id;
    save(s);
    return s;
  }

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
    if (!s.vehicles.length) return seed();
    if (s.activeId === id) s.activeId = s.vehicles[0].id;
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
      const delay = (new Date(h.date) - new Date(ver.t0 + "T00:00:00")) / 86400000;
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

  return { get, save, active, setActive, add, update, remove, estimateEarliness, seed };
})();
