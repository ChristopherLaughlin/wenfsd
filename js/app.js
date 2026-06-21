/* wenFSD — app wiring (garage-driven) */
(function () {
  const $ = (id) => document.getElementById(id);
  const today = WEN.today;

  let gstate = Garage.get();           // { vehicles, activeId }
  const ui = { target: "standard", guessDays: null, addingHistory: false, exploreRegion: null, guessRisk: "bold" };

  function av() { return Garage.active(gstate); }

  // effective rollout percentile = base, shifted earlier if you're in the Early Access Program.
  // If earliness came from real logged history it already reflects that — don't double-count.
  function effEarliness(v) {
    let e = v.earliness;
    if (v.earlinessSource !== "history" && v.earlyAccess) e += WEN.earlyAccessShift;
    return Math.min(0.97, Math.max(0.03, e));
  }

  // map active garage vehicle -> shape the predictor expects
  function car() {
    const v = av();
    return {
      model: v.model, year: v.year, hardware: v.hardware,
      market: v.market, drive: v.drive,
      earlinessPercentile: effEarliness(v), installedVersion: v.installedVersion,
      fsdVersion: v.fsdVersion, earlyAccess: v.earlyAccess, newCar: !!v.newCar,
    };
  }

  function currentPrediction() {
    return ui.target === "fsd" ? Predict.predictNextFSD(car(), today) : Predict.predictNextOS(car(), today);
  }

  // ---------------- render ----------------
  function setSegHint() {
    const el = $("segHint"); if (!el) return;
    el.innerHTML = ui.target === "fsd"
      ? `Showing the <strong>next FSD release</strong> (e.g. v13 → v14) — the self-driving software, on its own track. Tap <em>Next software update</em> for your next firmware build.`
      : `Showing your <strong>next OS build</strong> (the 2026.x.x firmware number). Tap <em>Next FSD version</em> for the next Full Self-Driving release.`;
  }
  function render() {
    setSegHint();
    if (!av()) { renderEmptyState(); return; }
    const pred = currentPrediction();
    const isFSD = ui.target === "fsd";
    $("curveVer").textContent = pred.targetLabel || (isFSD ? "FSD" : "OS");

    if (pred.capped || pred.unavailable) { renderNoPrediction(pred); return pred; }

    renderHero(pred);
    Charts.rolloutCurve($("curveChart"), pred, today);
    Charts.distribution($("distChart"), pred, today, ui.guessDays);
    renderGuess(pred);
    renderTable();
    renderRegions();
    renderReleaseNotes();
    return pred;
  }

  function renderEmptyState() {
    $("curveVer").textContent = "";
    $("heroEyebrow").textContent = "Welcome to wenFSD";
    $("heroDate").textContent = "Add your Tesla to begin";
    $("heroWindow").textContent = "";
    $("ringDays").textContent = "—"; $("ringFg").style.strokeDashoffset = 2 * Math.PI * 78;
    $("confRow").innerHTML = "";
    $("heroNote").innerHTML = "Add your car by VIN (we'll decode the model, year &amp; hardware) and wenFSD predicts your next software update and next FSD version — with confidence bands. No vehicles are tracked until you add one.";
    $("predictTips").innerHTML = "";
    $("curveChart").innerHTML = svgEmpty("Add a vehicle to see its rollout curve");
    $("distChart").innerHTML = svgEmpty("Add a vehicle to see the probability distribution");
    $("guessResult").classList.remove("show"); $("guessResult").innerHTML = "";
    renderTable();
    renderRegions();
    renderReleaseNotes();
  }
  function svgEmpty(msg) {
    return `<div class="chart-empty">${esc(msg)}</div>`;
  }

  function renderNoPrediction(pred) {
    $("heroEyebrow").textContent = (ui.target === "fsd" ? "Next FSD version" : "Next update") + " for " + (av().nickname || "your car");
    $("heroDate").textContent = pred.capped ? "Not coming" : "Unknown";
    $("heroWindow").textContent = pred.capped ? "hardware-limited" : "";
    $("ringDays").textContent = pred.capped ? "—" : "?"; $("ringFg").style.strokeDashoffset = 2 * Math.PI * 78;
    $("confRow").innerHTML = "";
    $("heroNote").innerHTML = `Currently on <strong>${esc(pred.current || "—")}</strong>. ${esc(pred.note || "")}`;
    $("predictTips").innerHTML = "";
    $("distChart").innerHTML = ""; $("curveChart").innerHTML = "";
    $("guessResult").classList.remove("show"); $("guessResult").innerHTML = "";
    renderTable();
    renderRegions();
    renderReleaseNotes();
  }

  function renderHero(pred) {
    const isFSD = ui.target === "fsd";
    const what = pred.targetLabel || (isFSD ? "next FSD" : "next update");
    $("heroEyebrow").textContent = `Predicted arrival of ${what} on ${av().nickname || "your car"}`;
    $("heroDate").textContent = Predict.fmtDate(pred.medianDate);
    $("heroWindow").textContent = "80% window: " + shortDate(pred.p10Date) + " → " + shortDate(pred.p90Date);

    const ring = $("ringFg"), C = 2 * Math.PI * 78, d = pred.daysToMedian;
    const frac = Math.max(0.04, Math.min(1, 1 - Math.min(d, 120) / 120));
    ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - frac);
    $("ringDays").textContent = d <= 0 ? "now" : d;

    const w7 = Math.round(pred.probWithin(7) * 100), w14 = Math.round(pred.probWithin(14) * 100), w30 = Math.round(pred.probWithin(30) * 100);
    $("confRow").innerHTML = [chip("7 days", w7), chip("14 days", w14), chip("30 days", w30)].join("");
    $("heroNote").innerHTML = `${esc(pred.note || "")} <span class="mut-i">Placed by your <strong>${pctLabel(effEarliness(av()))}</strong> rollout position${av().earlyAccess ? " (incl. Early Access)" : ""}.</span>`;
    renderBasis(pred);
    renderTips(pred);
  }

  // plain-language breakdown of HOW the date was computed + what it's based on
  function renderBasis(pred) {
    const v = av(), isFSD = ui.target === "fsd";
    const pct = pctLabel(effEarliness(v));
    const k = pred._k != null ? pred._k : 0.33;
    const mid = pred._t0Days != null ? Predict.fmtDate(Predict.addDays(today, pred._t0Days)) : null;

    let anchor;
    if (pred.mode === "gated") {
      anchor = `<strong>${esc(v.market)}</strong> isn't approved for <strong>${esc(pred.targetLabel)}</strong> yet, so the date is a <em>modelled regulatory window</em> — the least certain kind of estimate.`;
    } else if (mid) {
      anchor = `the model centres <strong>${esc(pred.targetLabel)}</strong>'s rollout around <strong>${mid}</strong> (curve steepness k≈${k}). Your rollout position then shifts you earlier or later than that midpoint.`;
    } else {
      anchor = `projected from Tesla's measured release cadence between builds.`;
    }

    $("predBasisBody").innerHTML =
      `<p><strong>What:</strong> when <strong>${esc(pred.targetLabel || (isFSD ? "the next FSD version" : "the next update"))}</strong> reaches <strong>${esc(v.nickname || "your car")}</strong>${pred.current ? ` (currently on ${esc(pred.current)})` : ""}.</p>` +
      `<ol class="basis-steps">` +
        `<li><strong>Your position:</strong> ${pred.wave === "existing"
          ? `for a <strong>major new FSD version</strong>, Tesla ships it to new deliveries first — your existing car waits for the separate, later OTA wave. (Tick “recent delivery” in your garage if you just took delivery.)`
          : pred.wave === "new"
          ? `you marked your car a <strong>recent delivery</strong>, so you're in the first wave for this new FSD version.`
          : `we place your car at its <strong>${pct}</strong> rollout position${v.earlyAccess ? " (incl. Early Access)" : ""} — where your car has historically landed within each update wave.`}</li>` +
        `<li><strong>The model:</strong> Tesla pushes each version as an S-curve across the fleet. We fit a logistic curve and read off your spot, then run Monte-Carlo for the 80% window.</li>` +
        `<li><strong>The timing anchor:</strong> ${anchor}</li>` +
      `</ol>` +
      `<p class="basis-conf">Confidence: <strong>${esc(confLabel(v))}</strong>.</p>` +
      `<p class="basis-warn">⚠️ Bands are <strong>modelled</strong> (logistic rollout + Monte-Carlo), not yet empirically back-tested against real per-car timing — treat as estimates. The anchor dates (the FSD one especially) are educated estimates, not a Tesla commitment.</p>`;
  }
  function confLabel(v) {
    return v.earlinessSource === "history" ? "higher — from your real update history"
      : v.earlyAccess ? "lower — typical-owner prior + your Early Access setting" : "lower — typical-owner prior";
  }

  // ONE actionable insight — the Early-Access delta (computed, not a generic CTA). The
  // generic "log history"/"connect Tesla" prompts live in the garage, so we don't repeat them.
  function renderTips(pred) {
    const v = av();
    let tip = "";
    if (!v.earlyAccess && v.earlinessSource !== "history") {
      const c2 = Object.assign(car(), { earlinessPercentile: effEarliness(Object.assign({}, v, { earlyAccess: true })) });
      const p2 = ui.target === "fsd" ? Predict.predictNextFSD(c2, today) : Predict.predictNextOS(c2, today);
      const delta = Math.round(pred.daysToMedian - (p2.daysToMedian != null ? p2.daysToMedian : pred.daysToMedian));
      if (delta >= 1) tip = `<div class="tips-list"><div class="tip">🔓 <strong>Tesla's Early Access Program</strong> would get this about <strong>${delta} day${delta > 1 ? "s" : ""} sooner</strong>. Too bad you aren't some sort of Tesla "influencer" filming yourself sitting in your car all day. 🎥</div></div>`;
    }
    $("predictTips").innerHTML = tip;
  }

  function chip(label, pct) {
    const cls = pct >= 66 ? "hi" : pct >= 33 ? "mid" : "lo";
    return `<div class="chip ${cls}"><div class="chip-pct">${pct}%</div><div class="chip-lbl">within ${label}</div></div>`;
  }

  // Kick off the Tesla OAuth link flow (works when served by the backend).
  function connectTesla() {
    if (/^https?:$/.test(location.protocol)) {
      window.location.href = "/auth/login";
    } else {
      alert("Connect Tesla works on the live site (wenfsd.info). In this offline preview, use 'Add by VIN' instead.");
    }
  }
  // persist a setting on a CONNECTED car to the server (so it survives reloads / devices).
  // Local-only cars and the file:// preview just update localStorage.
  function persistConnected(v, patch) {
    if (!v || !v.connected || !v.vin || !/^https?:$/.test(location.protocol)) return;
    fetch(`/api/me/vehicle/${encodeURIComponent(v.vin)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify(patch),
    }).catch(() => {});
  }
  // owner-triggered: wake the car and read its live software version (updates prediction).
  function refreshFromCar(v) {
    if (!/^https?:$/.test(location.protocol)) { alert("Waking your car works on the live site (wenfsd.info)."); return; }
    if (!v || !v.vin) return;
    const rb = $("refreshCarBtn"), rs = $("refreshStatus");
    if (rb) rb.disabled = true;
    if (rs) { rs.className = "refresh-status busy"; rs.textContent = "Waking your car… this can take up to ~30s"; }
    fetch(`/api/me/vehicle/${encodeURIComponent(v.vin)}/refresh`, { method: "POST", credentials: "same-origin" })
      .then(r => r.json().then(d => ({ status: r.status, d })))
      .then(({ status, d }) => {
        if (rb) rb.disabled = false;
        if (d.ok && d.version) {
          gstate = Garage.update(v.id, { installedVersion: d.version });
          if (rs) { rs.className = "refresh-status ok"; rs.textContent = `✓ Read ${d.version}${d.changed ? " — new version logged!" : " (unchanged)"}`; }
          renderActiveControls(); render();
        } else if (rs) {
          rs.className = "refresh-status err";
          rs.textContent = "⚠ " + (d.error || (status === 429 ? "Please wait a minute before trying again." : "Couldn't reach your car."));
        }
      })
      .catch(e => { if (rb) rb.disabled = false; if (rs) { rs.className = "refresh-status err"; rs.textContent = "⚠ " + (e && e.message || "request failed"); } });
  }
  function disconnectTesla() {
    if (!/^https?:$/.test(location.protocol)) return;
    fetch("/api/me", { method: "DELETE", credentials: "same-origin" }).catch(() => {}).finally(() => {
      const v = av(); if (v) gstate = Garage.update(v.id, { connected: false, optedIn: false });
      renderGarage(); renderActiveControls(); render();
    });
  }
  // reflect Tesla-connection + contribution state across the consent block + a header chip,
  // so it's always obvious whether you're linked and contributing.
  function renderConnectState(v) {
    const connected = !!(v && v.connected), contributing = connected && !!v.optedIn;
    const btn = $("connectTeslaBtn"), hint = $("connectHint"), chip = $("connChip");
    if (btn) {
      btn.classList.toggle("is-connected", connected);
      if (connected) { btn.textContent = "✓ Connected to Tesla — click to disconnect"; btn.onclick = () => { if (confirm("Disconnect your Tesla account and remove its linked data?")) disconnectTesla(); }; }
      else { btn.textContent = "🔗 Connect Tesla account — auto-track"; btn.onclick = connectTesla; }
    }
    if (hint) hint.innerHTML = connected
      ? `Your Tesla is linked <strong>read-only</strong> — wenFSD reads your software version automatically and scores a prediction when you next update. ${contributing ? "You're <strong>contributing</strong> anonymised version data to fleet stats." : "You're <strong>not</strong> contributing to fleet stats — tick the box above to help everyone's predictions."}`
      : `Linking uses Tesla's official OAuth (read-only) so wenFSD reads your software version automatically — no manual logging. You can disconnect or opt out anytime.`;
    if (chip) {
      chip.hidden = false;
      chip.className = "conn-chip " + (contributing ? "cc-on" : connected ? "cc-link" : "cc-off");
      chip.textContent = contributing ? "🔗 Connected · contributing" : connected ? "🔗 Connected" : "Not connected";
    }
  }

  // ---------------- garage ----------------
  function renderGarage() {
    if (!gstate.vehicles.length) {
      $("activeControls").hidden = true;
      $("addVehicleBtn").hidden = $("addForm").hidden ? false : true;
      $("garageList").innerHTML =
        `<div class="garage-empty">` +
        `<div class="ge-icon">🚗</div>` +
        `<div class="ge-title">Add your Tesla to get a prediction</div>` +
        `<div class="ge-sub">Two ways to track — pick one:</div>` +
        `<div class="ge-options">` +
          `<div class="ge-opt"><div class="ge-opt-h">🔗 Connect Tesla account</div>` +
          `<div class="ge-opt-d">Reads your software version automatically (read-only, never sends commands). Most accurate.</div>` +
          `<button class="btn" id="geConnect" type="button">Connect Tesla account</button></div>` +
          `<div class="ge-opt"><div class="ge-opt-h">⌨️ Add by VIN</div>` +
          `<div class="ge-opt-d">No account needed — enter your VIN and current version yourself.</div>` +
          `<button class="btn-ghost" id="geAdd" type="button">Add by VIN</button></div>` +
        `</div>` +
        `<button class="btn-link" id="geDemo" type="button">or just explore with a demo car</button></div>`;
      $("geConnect").onclick = connectTesla;
      $("geAdd").onclick = () => { $("addForm").hidden = false; $("addVehicleBtn").hidden = true; resetForm(); $("garageList").innerHTML = ""; $("vinInput").focus(); };
      $("geDemo").onclick = () => { gstate = Garage.loadDemo(); ui.guessDays = null; clearGuess(); renderGarage(); renderActiveControls(); render(); };
      return;
    }
    $("activeControls").hidden = false;
    $("garageList").innerHTML = gstate.vehicles.map(v => {
      const isA = v.id === gstate.activeId;
      const verText = v.installedVersion ? "on " + esc(v.installedVersion) : "version unknown — waiting for first Tesla read";
      return `<div class="gcar ${isA ? "active" : ""}" data-id="${v.id}">` +
        `<div class="gcar-main"><div class="gcar-name">${esc(v.nickname || v.model)}${v.connected ? ' <span class="gcar-link" title="Connected to your Tesla account">🔗 connected</span>' : ''}</div>` +
        `<div class="gcar-sub">${v.year} ${esc(v.model)}${v.generation ? " " + v.generation : ""} · ${v.hardware} · ${esc(v.market)}</div>` +
        `<div class="gcar-ver">${verText}</div></div>` +
        `<button class="gcar-x" data-del="${v.id}" title="Remove this vehicle">×</button>` +
        `</div>`;
    }).join("");

    $("garageList").querySelectorAll(".gcar").forEach(node => {
      node.onclick = (e) => {
        if (e.target.dataset.del) return;
        gstate = Garage.setActive(node.dataset.id);
        ui.guessDays = null; clearGuess();
        renderActiveControls(); render();
      };
    });
    $("garageList").querySelectorAll("[data-del]").forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); gstate = Garage.remove(b.dataset.del); renderActiveControls(); renderGarage(); render(); };
    });
  }

  function renderActiveControls() {
    if (!av()) { $("activeControls").hidden = true; return; }
    $("activeControls").hidden = false;
    const v = av();
    $("carBadge").textContent = v.hardware + (v.hardware === "AI4" ? " · HW4" : v.hardware === "AI3" ? " · HW3" : "");
    $("carModel").textContent = `${v.year} ${v.model}` + (v.generation ? ` · ${v.generation}` : "");
    $("carMeta").textContent = `${v.market} · ${v.drive || "—"}`;

    const ms = $("marketSel");
    ms.innerHTML = Object.keys(WEN.regionLag).map(m => `<option ${m === v.market ? "selected" : ""}>${m}</option>`).join("");
    ms.onchange = () => setMarket(ms.value);

    populateVersionOptions();
    const vs = $("versionSel");
    vs.value = v.installedVersion || "";
    setVerHint(vs.value);
    const commitVer = () => {
      const val = vs.value.trim();
      setVerHint(val);
      gstate = Garage.update(v.id, { installedVersion: val });
      renderGarage(); render();
    };
    vs.onchange = commitVer;
    vs.oninput = () => setVerHint(vs.value.trim());

    const es = $("earlySlider");
    es.value = Math.round(v.earliness * 100);
    setEarlyLabel();
    es.oninput = () => {
      gstate = Garage.update(v.id, { earliness: (+es.value) / 100, earlinessSource: "manual" });
      setEarlyLabel(); ui.guessDays = null; clearGuess(); render();
    };

    const ea = $("earlyAccessChk"); ea.checked = !!v.earlyAccess;
    ea.onchange = () => { gstate = Garage.update(v.id, { earlyAccess: ea.checked }); persistConnected(v, { earlyAccess: ea.checked }); ui.guessDays = null; clearGuess(); setEarlyLabel(); render(); };
    const nc = $("newCarChk"); if (nc) { nc.checked = !!v.newCar; nc.onchange = () => { gstate = Garage.update(v.id, { newCar: nc.checked }); ui.guessDays = null; clearGuess(); render(); }; }

    const opt = $("optInToggle");
    opt.checked = !!v.optedIn;
    opt.onchange = () => { gstate = Garage.update(v.id, { optedIn: opt.checked }); persistConnected(v, { optedIn: opt.checked }); renderConnectState(av()); };
    renderConnectState(v);

    // wake-car-and-read-version (connected cars only)
    const rr = $("refreshRow"), rb = $("refreshCarBtn"), rs = $("refreshStatus");
    if (rr) rr.hidden = !v.connected;
    if (rb) { rb.onclick = () => refreshFromCar(v); if (rs && !rs.textContent) rs.textContent = ""; }

    const clr = $("clearDataBtn");
    if (clr) clr.onclick = () => {
      if (confirm("Remove all your vehicles and history from this device? This can't be undone.")) {
        gstate = Garage.clearAll(); ui.guessDays = null; clearGuess(); renderGarage(); renderActiveControls(); render();
      }
    };

    renderHistory();
  }
  function setVerHint(val) {
    const el = $("verHint"); if (!el) return;
    if (!val) { el.textContent = ""; el.className = ""; return; }
    const ok = WEN.isValidVersion(val);
    el.textContent = ok ? "" : "— check the format (e.g. 2026.8.3.10)";
    el.className = ok ? "" : "ver-warn";
  }
  function populateVersionOptions() {
    const set = new Set();
    WEN.versions.forEach(v => set.add(v.version));
    (WEN.versionSuggestions || []).forEach(v => set.add(v));
    gstate.vehicles.forEach(v => { if (v.installedVersion) set.add(v.installedVersion); (v.history || []).forEach(h => h.version && set.add(h.version)); });
    const dl = $("versionOptions");
    if (dl) dl.innerHTML = [...set].sort((a, b) => WEN.verKey(b) - WEN.verKey(a)).map(v => `<option value="${esc(v)}"></option>`).join("");
  }
  function setEarlyLabel() {
    const v = av(), base = v.earliness, eff = effEarliness(v);
    const shifted = Math.abs(eff - base) > 0.005 && v.earlinessSource !== "history";
    $("earlyVal").textContent = shifted ? `${pctLabel(eff)} (after settings)` : pctLabel(eff);
  }

  // ---- update history -> estimated earliness ----
  function renderHistory() {
    const v = av();
    const list = v.history || [];
    $("histList").innerHTML = list.length
      ? list.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((h, i) =>
          `<li><span>${esc(h.version)}</span><span class="hmut">${h.date}</span><button class="hist-x" data-hi="${i}">×</button></li>`).join("")
      : `<li class="hist-empty">No updates logged yet. Add a couple to estimate your rollout percentile from real data.</li>`;

    $("histList").querySelectorAll("[data-hi]").forEach(b => {
      b.onclick = () => {
        const idx = +b.dataset.hi;
        const sorted = v.history.slice().sort((a, c) => (a.date < c.date ? 1 : -1));
        const target = sorted[idx];
        const newHist = v.history.filter(h => !(h.version === target.version && h.date === target.date));
        gstate = Garage.update(v.id, { history: newHist });
        applyEstimate(); renderHistory();
      };
    });

    const est = Garage.estimateEarliness(v);
    if (est) {
      $("earlyEstimate").innerHTML =
        `<div class="est-row"><span>📊 Estimated from ${est.n} logged update${est.n > 1 ? "s" : ""}: ` +
        `<strong>${pctLabel(est.earliness)}</strong></span>` +
        `<button class="btn-sm" id="applyEstBtn" type="button">Use this</button></div>` +
        `<div class="est-note">Derived by inverting the modelled rollout curve for each version — sharper than the slider, but only as good as the model until we have your live data.</div>`;
      $("applyEstBtn").onclick = () => {
        gstate = Garage.update(v.id, { earliness: est.earliness, earlinessSource: "history" });
        renderActiveControls(); ui.guessDays = null; clearGuess(); render();
      };
    } else {
      $("earlyEstimate").innerHTML = "";
    }
  }
  function applyEstimate() {
    const v = av(); const est = Garage.estimateEarliness(v);
    if (est && v.earlinessSource === "history") {
      gstate = Garage.update(v.id, { earliness: est.earliness });
      renderActiveControls(); render();
    }
  }

  // ---------------- add vehicle + VIN ----------------
  function wireAddForm() {
    $("addVehicleBtn").onclick = () => { $("addForm").hidden = false; $("addVehicleBtn").hidden = true; resetForm(); $("vinInput").focus(); };
    $("cancelVehicleBtn").onclick = () => { $("addForm").hidden = true; $("addVehicleBtn").hidden = false; renderGarage(); };

    $("f_market").innerHTML = Object.keys(WEN.regionLag).map(m => `<option ${m === "Australia" ? "selected" : ""}>${m}</option>`).join("");
    populateVersionOptions();

    $("vinDecodeBtn").onclick = doDecode;
    $("vinInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doDecode(); } });

    $("saveVehicleBtn").onclick = () => {
      const vin = $("vinInput").value.trim().toUpperCase();
      let gen = "";
      if (vin.length === 17) { const d = VIN.decode(vin); if (d.valid) gen = d.generation; }
      const market = $("f_market").value, hw = $("f_hw").value;
      const region = WEN.regions[market] || {};
      const fsdInfo = region.fsd ? region.fsd[hw] : null;
      const veh = {
        nickname: $("f_nick").value.trim() || $("f_model").value,
        vin,
        model: $("f_model").value,
        year: +$("f_year").value || 2026,
        generation: gen,
        hardware: hw,
        market,
        drive: region.drive || "RHD",
        installedVersion: $("f_ver").value.trim() || (WEN.versions[0] && WEN.versions[0].version) || "2026.14.6",
        fsdVersion: fsdInfo ? fsdInfo.current : "—",
        earliness: 0.5, earlinessSource: "default",
        updateChannel: "standard", earlyAccess: false,
        optedIn: false, history: [],
      };
      gstate = Garage.add(veh);
      $("addForm").hidden = true; $("addVehicleBtn").hidden = false;
      ui.guessDays = null; clearGuess();
      renderGarage(); renderActiveControls(); render();
    };

    $("connectTeslaBtn").onclick = connectTesla;

    $("addHistBtn").onclick = () => { $("histForm").hidden = !$("histForm").hidden; };
    $("h_add").onclick = () => {
      const ver = $("h_ver").value.trim(), date = $("h_date").value;
      if (!ver || !date) return;
      const v = av(); const hist = (v.history || []).concat([{ version: ver, date }]);
      gstate = Garage.update(v.id, { history: hist });
      $("h_date").value = ""; $("h_ver").value = ""; $("histForm").hidden = true;
      populateVersionOptions(); renderHistory();
    };
  }
  function resetForm() {
    $("vinInput").value = ""; $("vinResult").innerHTML = "";
    $("f_nick").value = ""; $("f_model").value = "Model Y"; $("f_year").value = 2026; $("f_hw").value = "AI4"; $("f_ver").value = "";
  }
  function doDecode() {
    const d = VIN.decode($("vinInput").value);
    if (!d.valid && d.warnings.length) {
      $("vinResult").innerHTML = `<div class="vin-warn">⚠ ${esc(d.warnings.join(" "))}</div>`;
      return;
    }
    // autofill the form
    if (d.model) $("f_model").value = d.model;
    if (d.year) $("f_year").value = d.year;
    if (d.hardware) $("f_hw").value = d.hardware;
    if (!$("f_nick").value) $("f_nick").value = d.displayName;
    const bits = [d.displayName, d.hardware + " (" + d.hardwareNote + ")", d.plant ? "Built " + d.plant : ""].filter(Boolean);
    $("vinResult").innerHTML = `<div class="vin-ok">✓ ${esc(bits.join(" · "))}</div>` +
      (d.warnings.length ? `<div class="vin-warn">⚠ ${esc(d.warnings.join(" "))}</div>` : "");
  }

  // ---------------- "Call your shot" guess game ----------------
  const RISK = {
    safe: { label: "🛡️ Sensible", window: 10, mult: 1, tag: "safe" },
    bold: { label: "🎯 Confident", window: 5, mult: 2.5, tag: "bold" },
    yolo: { label: "🎲 Trust me bro", window: 2, mult: 6, tag: "yolo" },
  };
  function renderGuess(pred) {
    if (!$("guessDate").value) $("guessDate").value = Predict.isoDay(pred.medianDate);
    document.querySelectorAll("#nervePick .nerve-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.risk === ui.guessRisk);
      b.onclick = () => {
        ui.guessRisk = b.dataset.risk;
        document.querySelectorAll("#nervePick .nerve-btn").forEach(x => x.classList.toggle("active", x === b));
        if (ui.guessDays != null) showGuessResult(pred);
      };
    });
    if (ui.guessDays != null) showGuessResult(pred);
  }
  function showGuessResult(pred) {
    const guessStr = $("guessDate").value;
    if (!guessStr || isNaN(new Date(guessStr + "T00:00:00Z"))) {
      $("guessResult").classList.add("show");
      $("guessResult").innerHTML = `<div class="muted">Pick a valid date first 📅</div>`;
      return;
    }
    const risk = RISK[ui.guessRisk] || RISK.bold;
    const g = Predict.daysBetween(today, guessStr);
    ui.guessDays = g;
    const odds = Math.round(Math.max(0, Math.min(1, pred.probWithin(g + risk.window) - pred.probWithin(g - risk.window))) * 100);
    const potential = Math.round(100 * risk.mult);
    const v = av();
    const target = pred.targetLabel || "the next update";
    const dateNice = Predict.fmtDate(guessStr).replace(/^\w+, /, "");
    const blurb = `📲 Calling it: my Tesla gets ${target} by ${dateNice} (${risk.label} mode). wenFSD gives me ${odds}%. Screenshot so you can mock me later 😤 → wenfsd.info`;
    $("guessResult").innerHTML =
      `<div class="shot shot-${risk.tag}">` +
        `<div class="shot-mode">${risk.label} mode</div>` +
        `<div class="shot-call">You're calling <strong>${esc(target)}</strong> by <strong>${esc(dateNice)}</strong>.</div>` +
        `<div class="shot-stats"><div><b>${odds}%</b><span>house odds you nail the ±${risk.window}-day window</span></div><div><b>🪙 ${potential}</b><span>wenPoints if you're right</span></div></div>` +
        `<div class="shot-verdict">${guessVerdict(risk, odds, g, pred)}</div>` +
        `<div class="shot-stake">📸 Lock it in, screenshot it, hold yourself to it. The model's odds are the house — your job is to beat them.</div>` +
        `<div class="shot-actions"><button class="btn-sm" id="copyBrag" type="button">🔗 Copy brag</button><button class="btn-sm" id="shareTmc" type="button">💬 Take it to TMC</button></div>` +
      `</div>`;
    $("guessResult").classList.add("show");
    Charts.distribution($("distChart"), pred, today, ui.guessDays);
    $("copyBrag").onclick = () => copyText(blurb, $("copyBrag"));
    $("shareTmc").onclick = () => { copyText(blurb, $("shareTmc")); window.open("https://teslamotorsclub.com/tmc/", "_blank", "noopener"); };
  }
  function guessVerdict(risk, odds, g, pred) {
    const off = Math.round(g - pred.daysToMedian);
    if (risk.tag === "yolo") {
      if (odds <= 12) return `Absolute degenerate behaviour. The model gives you ${odds}%. Two weeks? Trust me bro. 🫡`;
      if (odds >= 35) return `Bold <em>and</em> the model agrees?! Suspicious. Are you secretly a Tesla engineer?`;
      return `Respect the nerve — ${odds}% at a 6× payout. Fortune favours the brave (occasionally).`;
    }
    if (risk.tag === "safe") {
      return odds >= 45 ? `The sensible choice. You'll probably be right, and nobody will be impressed. 🥱`
        : `Playing it safe… while still fighting the model. Bold strategy, Cotton.`;
    }
    if (off > 7) return `Betting it drags. The cynic's special — the model thinks you're <em>too</em> pessimistic.`;
    if (off < -7) return `Betting it lands early, you optimist. The model says don't hold your breath.`;
    return `A respectable call. The model gives you ${odds}%.`;
  }
  function copyText(text, btn) {
    const done = () => { if (!btn) return; const t = btn.textContent; btn.textContent = "✓ Copied!"; setTimeout(() => { btn.textContent = t; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); if (done) done();
  }
  function clearGuess() { $("guessResult").classList.remove("show"); $("guessResult").innerHTML = ""; $("guessDate").value = ""; }

  // ---------------- static panels ----------------
  function pctLabel(p) {
    const pct = Math.round(p * 100);
    const word = p <= 0.2 ? "very early" : p <= 0.4 ? "earlier than most" : p <= 0.6 ? "average" : p <= 0.8 ? "later than most" : "very late";
    return `${word} (~${pct}th pct)`;
  }
  const MODE_LABEL = { rolling: "Rolling out", early: "Early/staged rollout", gated: "Awaiting approval", current: "On newest", capped: "Hardware-capped" };
  function activeFsdRegion() { return ui.exploreRegion || (av() ? av().market : "Australia"); }

  function renderFSD() {
    const v = av(), rname0 = activeFsdRegion();
    const region = WEN.regions[rname0] || {};
    const hw = v ? v.hardware : "AI4";
    const isYours = !!(v && rname0 === v.market);
    const f = region.fsd ? region.fsd[hw] : null;

    // region picker
    const sel = $("exploreRegionSel");
    if (sel) {
      sel.innerHTML = Object.keys(WEN.regions).map(m => `<option ${m === rname0 ? "selected" : ""}>${m}${v && m === v.market ? " — you" : ""}</option>`).join("");
      sel.onchange = () => { ui.exploreRegion = sel.value.replace(/ — you$/, ""); renderFSD(); renderRegions(); };
    }

    // typical-car ETA for the explored region (existing fleet, 50th pct) — or your car if it's your region
    const etaCar = isYours ? car() : { market: rname0, hardware: hw, fsdVersion: f ? f.current : null, earlinessPercentile: 0.5, earlyAccess: false, newCar: false };
    const fp = f ? Predict.predictNextFSD(etaCar, today) : null;
    const eta = fp && !fp.capped && !fp.unavailable ? Predict.fmtDate(fp.medianDate).replace(/^\w+, /, "") : (f && (f.mode === "capped" || (fp && fp.capped)) ? "capped" : "—");
    $("fsdGrid").innerHTML =
      `<div class="fsd-stat"><div class="fsd-num">${f ? (MODE_LABEL[f.mode] || f.mode) : "—"}</div><div class="fsd-lbl">FSD status · ${esc(rname0)} ${esc(hw)}</div></div>` +
      `<div class="fsd-stat"><div class="fsd-num">${f ? esc(f.current) : "—"}</div><div class="fsd-lbl">current FSD ${isYours ? "(yours)" : "(typical car)"}</div></div>` +
      `<div class="fsd-stat"><div class="fsd-num">${esc(eta)}</div><div class="fsd-lbl">next FSD — ${isYours ? "your ETA" : "typical-car ETA"}</div></div>`;

    // region × hardware matrix (highlights the explored region)
    const rows = Object.keys(WEN.regions).map(rname => {
      const r = WEN.regions[rname];
      const cell = (hw) => {
        const x = r.fsd[hw];
        if (!x) return `<td class="mx-na">—</td>`;
        const next = x.next ? `<span class="mx-next">→ ${esc(x.next)}</span>` : `<span class="mx-capped">capped</span>`;
        return `<td><div class="mx-cur">${esc(x.current)}</div><div class="mx-mode mode-${x.mode}">${MODE_LABEL[x.mode] || x.mode}</div>${next}</td>`;
      };
      const isShown = rname === rname0, isCar = v && rname === v.market;
      return `<tr class="${isShown ? "mx-active" : ""} mx-click" data-explore-region="${esc(rname)}" title="Explore ${esc(rname)}"><td class="mx-region">${esc(rname)}${isCar ? ' <span class="tag-you">you</span>' : ''}</td>${cell("AI4")}${cell("AI3")}</tr>`;
    }).join("");
    $("fsdMatrix").innerHTML =
      `<table class="mx-table"><thead><tr><th>Region</th><th>HW4 / AI4</th><th>HW3 / AI3</th></tr></thead><tbody>${rows}</tbody></table>`;

    const tlHead = $("fsdTlHead"); if (tlHead) tlHead.textContent = `${rname0} FSD timeline`;
    $("fsdTimeline").innerHTML = WEN.fsdMilestones.map(m =>
      `<li class="${m.done ? "done" : "pending"}"><span class="tl-dot"></span><span class="tl-date">${esc(m.date)}</span><span class="tl-label">${esc(m.label)}</span></li>`).join("");
  }
  // ---- sample-vs-live honesty indicator ----
  function renderDataMode() {
    const live = WEN.dataMode === "live";
    const el = $("dataMode"), lbl = $("dataModeLabel");
    if (lbl) lbl.textContent = live ? "live fleet data" : "sample data";
    if (el) { el.classList.toggle("is-sample", !live); el.title = live ? "Live, aggregated from connected cars + trackers" : "Illustrative sample data — connect a backend / your Tesla for live figures"; }
    const fwSub = document.querySelector("#fwSub");
    if (fwSub) fwSub.textContent = live ? "live distribution" : "sample distribution";
    // fleet sections: always visible. Firmware/feed become REAL once live (tracker-aggregated);
    // the FSD-by-region matrix, OS-lag panel and release-note text stay modelled either way, so
    // they keep an honest "regional timing is modelled" badge even in live mode.
    // release notes become REAL when scraped live; the FSD-by-region & OS-lag panels are
    // always modelled (their regional *timing* is always our estimate).
    const ALWAYS_MODELLED = new Set(["fsdCard", "regionCard"]);
    if (WEN.releaseNotesSource !== "live") ALWAYS_MODELLED.add("releaseNotesCard");
    document.querySelectorAll(".fleet-card").forEach(card => {
      card.style.display = "";
      if (card.id === "calibrationCard") { const b = card.querySelector(":scope > .est-badge"); if (b) b.remove(); card.classList.remove("estimate-mode"); return; } // self-describes its own mode
      const modelled = ALWAYS_MODELLED.has(card.id);
      const showBadge = modelled || !live;
      card.classList.toggle("estimate-mode", showBadge);
      let badge = card.querySelector(":scope > .est-badge");
      if (showBadge) {
        if (!badge) { badge = document.createElement("div"); badge.className = "est-badge"; card.insertBefore(badge, card.firstChild); }
        badge.innerHTML = modelled
          ? `⚠️ Regional rollout <strong>timing</strong> is modelled — not observed. Version numbers &amp; FSD builds shown are real where available.`
          : `⚠️ Modelled estimate — not live fleet data. <span>Firms up as real cars connect &amp; trackers are aggregated.</span>`;
      } else if (badge) { badge.remove(); }
    });
    const banner = $("sampleBanner");
    if (banner) {
      banner.hidden = false;
      banner.className = live ? "sample-banner sb-live" : "sample-banner";
      banner.innerHTML = live
        ? `✓ Showing live fleet data aggregated from connected cars + public trackers.`
        : `Showing <strong>your real car data</strong> plus <em>modelled estimates</em> for the fleet-wide views below — each one clearly badged. Estimates become live figures as real Teslas connect and we aggregate the public trackers. No figure is presented as observed unless it is.`;
    }
  }

  // ---- model calibration / back-test against real tracker history ----
  function renderCalibration(cal) {
    const el = $("calibrationBody");
    if (!el) return;
    const acc = cal && cal.accuracy;
    const haveLive = cal && cal.mode === "live";
    const haveAcc = acc && acc.scored > 0;
    if (!haveLive && !haveAcc) {
      const openNote = acc && acc.open ? ` <strong>${acc.open} prediction${acc.open === 1 ? "" : "s"}</strong> currently open, awaiting the next update.` : "";
      el.innerHTML = `<p class="cal-note">Calibration appears once live sources are enabled. It back-tests the engine against real release history from the public trackers — cadence, rollout velocity and coverage. No fabricated accuracy figure is shown: per-car hit-rate is published only once enough connected cars provide ground truth.${openNote}</p>`;
      return;
    }
    const c = cal.cadence, v = cal.velocity, cov = cal.coverage, tiles = [];
    if (haveAcc) tiles.push(["Prediction accuracy", `${acc.hitRate}% in-window`, `${acc.scored} connected-car prediction${acc.scored === 1 ? "" : "s"} scored vs reality${acc.medianAbsErrorDays != null ? ` · median miss ±${acc.medianAbsErrorDays}d` : ""}`, true]);
    if (c) tiles.push(["Release cadence", `~${c.medianDays}d`, `median between OS branches · ${c.meanDays}±${c.sdDays}d mean · from ${c.branches} real branches`]);
    if (v) tiles.push(["Rollout velocity", `~${v.medianDaysQ1toQ3}d`, `installs go 25%→75% once a version reaches cars · ${v.sampleVersions} rollouts (TeslaFi daily data)`]);
    if (cov) tiles.push(["Coverage", `${cov.versions} versions`, `${cov.versionsWithShare} with fleet share · ${cov.sourceCount} live sources`]);
    el.innerHTML =
      `<div class="cal-grid">` +
      tiles.map(([h, big, sub, hot]) => `<div class="cal-tile${hot ? " cal-hot" : ""}"><div class="cal-h">${esc(h)}</div><div class="cal-big">${esc(big)}</div><div class="cal-sub">${esc(sub)}</div></div>`).join("") +
      `</div>` +
      (cov && cov.sources && cov.sources.length ? `<div class="cal-src">Validated against real history from: <strong>${cov.sources.map(esc).join(" · ")}</strong></div>` : "") +
      `<div class="cal-honesty">✓ ${esc(cal.honesty || "")}</div>`;
  }

  // ---- data sources attribution (we aggregate the public trackers) ----
  const DEFAULT_SOURCES = [
    { name: "Tessie", homepage: "https://stats.tessie.com/", ok: true }, { name: "Teslascope", homepage: "https://teslascope.com/software", ok: true }, { name: "TeslaFi", homepage: "https://teslafi.com/firmware.php", ok: true },
    { name: "Tesla Updates", homepage: "https://teslaupdates.org/rollouts", ok: true }, { name: "FleetCtrl", homepage: "https://fleetctrl.app/", ok: true },
  ];
  function renderDataSources(sources, live) {
    const list = sources || DEFAULT_SOURCES;
    $("dataSources").innerHTML =
      `<span class="ds-label">${live ? "Live data aggregated from" : "Aggregates"}:</span>` +
      list.map(s => {
        const inner = `${esc(s.name)}${s.ok !== false && s.versions ? " · " + s.versions : ""}`;
        const cls = `ds-pill ${s.ok === false ? "ds-down" : ""}`;
        return s.homepage ? `<a class="${cls}" href="${esc(s.homepage)}" target="_blank" rel="noopener" title="Open ${esc(s.name)}">${inner} ↗</a>` : `<span class="${cls}">${inner}</span>`;
      }).join("") +
      `<span class="ds-note">wenFSD merges these (fleet-weighted) and adds the prediction layer none of them have.</span>`;
  }

  // ---- release notes (fleetctrl-style changelog) ----
  const RN_TAG = { FSD: "rn-fsd", Dashcam: "rn-feat", Charging: "rn-feat", Sentry: "rn-feat", Nav: "rn-feat", Fix: "rn-fix", Safety: "rn-safety", UI: "rn-ui" };
  function renderReleaseNotes() {
    const mine = av() ? av().installedVersion : null;
    const order = WEN.versions.map(v => v.version).filter(v => WEN.releaseNotes[v]);
    $("releaseNotes").innerHTML = order.map(ver => {
      const rn = WEN.releaseNotes[ver];
      const isMine = ver === mine;
      const items = rn.items.map(it => `<li><span class="rn-tag ${RN_TAG[it.tag] || "rn-feat"}">${esc(it.tag)}</span>${esc(it.text)}</li>`).join("");
      const regions = (rn.regions || []).map(r => `<span class="rn-region">${esc(r)}</span>`).join("");
      return `<details class="rn-item${isMine ? " rn-mine" : ""}" data-ver="${esc(ver)}"${isMine ? " open" : ""}>` +
        `<summary><span class="rn-ver">${esc(ver)}</span>${isMine ? ' <span class="tag-you">you</span>' : ''}` +
        `<span class="rn-date">${esc(rn.date)}</span><span class="rn-fsdb">FSD ${esc(rn.fsd || "—")}</span>` +
        `<span class="rn-regions">${regions}</span></summary>` +
        `<ul class="rn-items">${items}</ul>` +
        `<div class="rn-src">via ${esc(rn.source || "trackers")}</div></details>`;
    }).join("");
  }

  // ---- per-region OS rollout panel (country breakdown) ----
  // change the active car's market (used by the region dropdown, region rows, FSD matrix)
  function setMarket(name) {
    const v = av(); if (!v || !WEN.regions[name] || name === v.market) return;
    gstate = Garage.update(v.id, { market: name });
    persistConnected(v, { market: name });
    renderActiveControls(); renderGarage(); ui.guessDays = null; clearGuess(); render();
  }
  // jump to a version's release note (opening it) or its firmware-table row
  function gotoVersion(ver) {
    const d = document.querySelector(`#releaseNotes details[data-ver="${ver}"]`);
    if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "center" }); flash(d); return; }
    const rows = [...document.querySelectorAll("#fwBody tr")];
    const row = rows.find(r => r.querySelector("strong") && r.querySelector("strong").textContent.trim().startsWith(ver));
    if (row) { row.scrollIntoView({ behavior: "smooth", block: "center" }); flash(row); }
  }
  function flash(el) { el.classList.add("rn-flash"); setTimeout(() => el.classList.remove("rn-flash"), 1200); }

  // explore a region's data (FSD card + region highlights) — independent of your car
  function exploreRegion(name) {
    if (!WEN.regions[name]) return;
    ui.exploreRegion = name; renderFSD(); renderRegions();
    const card = $("fsdCard"); if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderRegions() {
    const shown = activeFsdRegion();
    const carMarket = av() ? av().market : null;
    const base = WEN.regions["United States"].osLagDays;
    const lags = Object.values(WEN.regions).map(r => r.osLagDays - base);
    const maxLag = Math.max(1, ...lags);
    $("regionPanel").innerHTML = Object.keys(WEN.regions).map(name => {
      const r = WEN.regions[name];
      const lag = r.osLagDays - base;
      const p = Predict.predictNextOS({ market: name, hardware: "AI4", installedVersion: "2026.14.6", earlinessPercentile: 0.5 }, today);
      const isShown = name === shown, isCar = name === carMarket;
      const barW = (lag / maxLag) * 100;
      return `<div class="rp-row ${isShown ? "rp-active" : ""} rp-click" data-explore-region="${esc(name)}" title="Explore ${esc(name)}">` +
        `<div class="rp-name">${esc(name)}${isCar ? ' <span class="tag-you">you</span>' : ''} <span class="rp-drive">${r.drive}</span></div>` +
        `<div class="rp-lag">${lag === 0 ? "US baseline" : "+" + lag + "d behind US"}</div>` +
        `<div class="rp-bar"><span style="width:${Math.max(2, barW)}%"></span></div>` +
        `<div class="rp-eta">${esc(p.targetLabel)} in <strong>~${Math.max(0, p.daysToMedian)}d</strong></div>` +
        `</div>`;
    }).join("");
  }

  // 7-day install-velocity sparkline, derived from the version's logistic (mirrors the
  // "install calendar" the real trackers show — but generated from the model).
  function sparkSVG(v) {
    const t0Days = Predict.daysBetween(today, v.t0), L = 0.95, fleet = WEN.stats.auCars;
    const vals = []; let max = 0;
    for (let d = -6; d <= 0; d++) {
      const inst = Math.max(0, (Predict.adoption(d - t0Days, v.k, L) - Predict.adoption(d - 1 - t0Days, v.k, L)) * fleet);
      vals.push(inst); if (inst > max) max = inst;
    }
    const w = 60, h = 18, bw = w / 7;
    const bars = vals.map((inst, i) => { const bh = max > 0 ? Math.max(1, (inst / max) * h) : 1; return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"/>`; }).join("");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="7-day install velocity">${bars}</svg>`;
  }
  function renderTable() {
    const mine = av() ? av().installedVersion : null;
    $("fwBody").innerHTML = WEN.versions.map(v => {
      const isMine = v.version === mine;
      const hasNotes = !!WEN.releaseNotes[v.version];
      return `<tr class="${isMine ? "mine" : ""}">` +
        `<td>${hasNotes ? `<strong class="fw-verlink" data-goto-version="${esc(v.version)}" role="button" tabindex="0" title="See ${esc(v.version)} release notes">${v.version}</strong>` : `<strong>${v.version}</strong>`}${isMine ? ' <span class="tag-you">you</span>' : ''}</td>` +
        `<td><span class="status status-${v.status}">${v.status}</span></td>` +
        `<td>${v.fleetPct != null ? `<div class="pctcell"><span class="pctbar" style="width:${Math.min(100, v.fleetPct * 2.2)}%"></span><em>${v.fleetPct}%</em></div>` : `<span class="mut-i">not reported</span>`}</td>` +
        `<td>${v.fleetPct != null ? sparkSVG(v) : "—"}</td>` +
        `<td>${v.firstSeen ? shortDate(v.firstSeen) : "—"}</td><td>${(v.fsdBuild && v.fsdBuild.AI4) || "—"}</td>` +
        `<td class="notes">${v.recentInstalls ? `<span class="fw-active">🔥 ${Number(v.recentInstalls).toLocaleString()} installs this week</span>` : (v.notes || "")}</td></tr>`;
    }).join("");
  }
  function renderStats() {
    if (WEN.dataMode !== "live") {
      $("statsStrip").innerHTML = `<div class="stats-sample">Fleet totals appear here once real cars connect — wenFSD shows no invented numbers.</div>`;
      return;
    }
    const s = WEN.stats; // real DB-derived counts in live mode
    $("statsStrip").innerHTML = [["cars tracked", (+s.carsTracked || 0).toLocaleString()], ["AU cars", (+s.auCars || 0).toLocaleString()],
      ["updates logged", (+s.updatesLogged || 0).toLocaleString()], ["versions", s.versionsTracked || 0]]
      .map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
  }
  // Real rollout-activity feed: recent version RELEASES from the tracker data (firstSeen,
  // fleet %, install activity, FSD build, sources). Replaces the old fabricated per-car
  // ticker — no invented cities, no fake "just now" stream. Live in live mode; seed model
  // (badged) in sample mode. Sorted newest-first by first-seen.
  function renderFeed() {
    const feed = $("feed");
    if (!feed) return;
    const rows = (WEN.versions || [])
      .filter(v => v.firstSeen)
      .slice()
      .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)))
      .slice(0, 8);
    if (!rows.length) { feed.innerHTML = `<li class="feed-empty">No recent rollout activity yet.</li>`; $("feedSub").textContent = ""; return; }
    feed.innerHTML = rows.map(v => {
      const pct = v.fleetPct != null ? `${v.fleetPct}% of fleet` : null;
      const inst = v.recentInstalls ? `🔥 ${Number(v.recentInstalls).toLocaleString()} installs/wk` : null;
      const fsd = (v.fsdBuild && v.fsdBuild.AI4 && v.fsdBuild.AI4 !== "—") ? `FSD ${v.fsdBuild.AI4}` : null;
      const meta = [pct, inst, fsd].filter(Boolean).join(" · ");
      const src = (v.sources && v.sources.length) ? `via ${v.sources.join(", ")}` : "";
      return `<li><span class="feed-when">${shortDate(v.firstSeen)}</span>` +
        `<span class="feed-main"><strong class="feed-relver" data-goto-version="${esc(v.version)}" role="button" tabindex="0" title="See ${esc(v.version)} details">${esc(v.version)}</strong>${meta ? ` <span class="feed-meta">${esc(meta)}</span>` : ""}</span>` +
        `<span class="feed-ver">${esc(src)}</span></li>`;
    }).join("");
    $("feedSub").textContent = rows.length + " recent releases";
  }

  // ---------------- events ----------------
  function wire() {
    // delegated clicks for dynamically-rendered interactive elements (region rows, FSD
    // matrix rows, firmware/feed version links) — bound once, survive re-renders.
    function handleActivate(e) {
      const er = e.target.closest("[data-explore-region]");
      if (er) { e.preventDefault(); exploreRegion(er.getAttribute("data-explore-region")); return; }
      const g = e.target.closest("[data-goto-version]");
      if (g) { e.preventDefault(); gotoVersion(g.getAttribute("data-goto-version")); return; }
    }
    document.addEventListener("click", handleActivate);
    document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-goto-version],[data-explore-region]")) handleActivate(e); });

    document.querySelectorAll("#targetSeg .seg-btn").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll("#targetSeg .seg-btn").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
        btn.classList.add("active"); btn.setAttribute("aria-selected", "true"); ui.target = btn.dataset.target;
        ui.guessDays = null; clearGuess(); render();
        $("fsdCard").classList.toggle("spotlight", ui.target === "fsd");
        if (ui.target === "fsd") $("fsdCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    });
    $("guessBtn").onclick = () => showGuessResult(currentPrediction());
    window.addEventListener("resize", debounce(() => render(), 150));
  }
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function shortDate(d) { return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------------- boot ----------------
  // Expose the live-data bridge FIRST, before any render runs — so js/api.js can always
  // call setLinkState/addConnectedVehicles even if a boot render throws.
  window.WENFSD = {
    rerender() { renderFSD(); renderStats(); renderDataMode(); renderFeed(); render(); },
    setSources(list, live) { renderDataSources(list, live); },
    setCalibration(cal) { renderCalibration(cal); },
    addConnectedVehicles, setLinkState,
    get activeVehicle() { return av(); },
  };

  $("todayLabel").textContent = new Date(today + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  renderGarage();
  renderActiveControls();
  wireAddForm();
  renderFSD();
  renderStats();
  renderDataMode();
  renderDataSources();
  renderFeed();
  renderCalibration();
  wire();
  render();

  // Pull the owner's Tesla-linked vehicles (from /api/me/vehicles) into the garage.
  function addConnectedVehicles(list) {
    if (!Array.isArray(list) || !list.length) return;
    list.forEach(v => {
      const market = (WEN.regions[v.market]) ? v.market : "Australia";
      const region = WEN.regions[market] || {};
      const s = Garage.get();
      const existing = s.vehicles.find(x => (x.vin || "").toUpperCase() === (v.vin || "").toUpperCase());
      if (existing) {
        const patch = {
          model: v.model || existing.model, year: v.model_year || existing.year,
          generation: v.generation || existing.generation, hardware: v.hardware || existing.hardware,
          market, drive: v.drive || region.drive || existing.drive,
          earlyAccess: !!v.early_access, optedIn: !!v.opted_in, connected: true,
        };
        if (v.current_version) patch.installedVersion = v.current_version;   // don't clobber a manual entry with null
        if (v.earliness != null) { patch.earliness = v.earliness; patch.earlinessSource = "history"; }
        gstate = Garage.update(existing.id, patch);
      } else {
        gstate = Garage.add({
          nickname: [v.model_year, v.model, v.generation].filter(Boolean).join(" ") || "My Tesla",
          vin: v.vin, model: v.model || "Model Y", year: v.model_year || 2026, generation: v.generation || "",
          hardware: v.hardware || "AI4", market, drive: v.drive || region.drive || "RHD",
          installedVersion: v.current_version || "", fsdVersion: "",
          earliness: v.earliness != null ? v.earliness : 0.5, earlinessSource: v.earliness != null ? "history" : "default",
          earlyAccess: !!v.early_access, optedIn: !!v.opted_in, connected: true, history: [],
        });
      }
    });
    // render defensively — the car is already saved to the garage, so a render hiccup
    // in one section never prevents it appearing.
    try { renderGarage(); } catch (e) { console.warn(e); }
    try { renderActiveControls(); } catch (e) { console.warn(e); }
    try { render(); } catch (e) { console.warn(e); }
  }

  // Visible Tesla-connection status (so the link state is never a mystery).
  function setLinkState(state) {
    const el = $("linkStatus"); if (!el) return;
    el.hidden = false;
    if (state.status === 200 && Array.isArray(state.vehicles) && state.vehicles.length) {
      el.className = "link-status ls-ok";
      el.innerHTML = `🔗 <strong>Connected to Tesla</strong> — ${state.vehicles.length} vehicle${state.vehicles.length > 1 ? "s" : ""} linked.`;
      addConnectedVehicles(state.vehicles);
    } else if (state.status === 200) {
      el.className = "link-status ls-warn";
      el.innerHTML = `Connected to Tesla, but the API returned no vehicles yet. If you just linked, wait a moment and reload.`;
    } else {
      el.className = "link-status ls-off";
      el.innerHTML = `Not connected on this device (or your session expired). Use <strong>Connect Tesla account</strong> below to link your car.`;
    }
  }
})();
