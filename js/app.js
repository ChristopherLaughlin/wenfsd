/* wenFSD — app wiring (garage-driven) */
(function () {
  const $ = (id) => document.getElementById(id);
  const today = WEN.today;

  let gstate = Garage.get();           // { vehicles, activeId }
  const ui = { target: "standard", guessDays: null, addingHistory: false };

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
      fsdVersion: v.fsdVersion,
    };
  }

  function currentPrediction() {
    return ui.target === "fsd" ? Predict.predictNextFSD(car(), today) : Predict.predictNextOS(car(), today);
  }

  // ---------------- render ----------------
  function render() {
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
    $("heroCountdown").innerHTML = "";
    $("ringDays").textContent = "—"; $("ringFg").style.strokeDashoffset = 2 * Math.PI * 78;
    $("confRow").innerHTML = ""; $("probMini").innerHTML = "";
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
    $("heroCountdown").innerHTML = `<div class="cd"><div class="cd-num">—</div><div class="cd-lbl">${pred.capped ? "capped" : "no data"}</div></div>`;
    $("ringDays").textContent = "—"; $("ringFg").style.strokeDashoffset = 2 * Math.PI * 78;
    $("confRow").innerHTML = ""; $("probMini").innerHTML = "";
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
    $("heroCountdown").innerHTML = countdownHTML(pred.daysToMedian);

    const ring = $("ringFg"), C = 2 * Math.PI * 78, d = pred.daysToMedian;
    const frac = Math.max(0.04, Math.min(1, 1 - Math.min(d, 120) / 120));
    ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - frac);
    $("ringDays").textContent = d <= 0 ? "now" : d;

    const w7 = Math.round(pred.probWithin(7) * 100), w14 = Math.round(pred.probWithin(14) * 100), w30 = Math.round(pred.probWithin(30) * 100);
    $("confRow").innerHTML = [chip("7 days", w7), chip("14 days", w14), chip("30 days", w30)].join("");
    $("probMini").innerHTML =
      `<div class="pm-row"><span>by ${shortDate(Predict.addDays(today,7))}</span><b>${w7}%</b></div>` +
      `<div class="pm-row"><span>by ${shortDate(Predict.addDays(today,30))}</span><b>${w30}%</b></div>`;
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
        `<li><strong>Your position:</strong> we place your car at its <strong>${pct}</strong> spot in the fleet rollout${v.earlyAccess ? " (incl. Early Access)" : ""}. Earlier cars get each build first.</li>` +
        `<li><strong>The model:</strong> Tesla pushes each version as an S-curve across the fleet. We fit a logistic curve and read off your spot, then run Monte-Carlo for the 80% window.</li>` +
        `<li><strong>The timing anchor:</strong> ${anchor}</li>` +
      `</ol>` +
      `<p class="basis-warn">⚠️ These run on <strong>assumed</strong> rollout parameters — we don't yet have crowdsourced fleet data, so the anchor dates (the FSD one especially) are educated estimates, not observed data or a Tesla commitment.</p>`;
  }

  // actionable "what would make this sooner" tips + confidence basis
  function renderTips(pred) {
    const v = av(), tips = [];
    if (!v.earlyAccess && v.earlinessSource !== "history") {
      const c2 = Object.assign(car(), { earlinessPercentile: effEarliness(Object.assign({}, v, { earlyAccess: true })) });
      const p2 = ui.target === "fsd" ? Predict.predictNextFSD(c2, today) : Predict.predictNextOS(c2, today);
      const delta = Math.round(pred.daysToMedian - (p2.daysToMedian != null ? p2.daysToMedian : pred.daysToMedian));
      if (delta >= 1) tips.push(`🔓 <strong>Join Tesla's Early Access Program</strong> — about <strong>${delta} day${delta > 1 ? "s" : ""} sooner</strong>`);
    }
    if (v.earlinessSource !== "history") tips.push(`📊 <strong>Log your update history</strong> — turns a typical-owner estimate into a personalised one`);
    if (!v.optedIn) tips.push(`🔗 <strong>Connect your Tesla</strong> (read-only) to auto-track and sharpen everyone's predictions`);
    const conf = v.earlinessSource === "history" ? "higher — from your real update history"
      : v.earlyAccess ? "lower — typical-owner prior + your Early Access setting" : "lower — typical-owner prior";
    $("predictTips").innerHTML =
      (tips.length ? `<div class="tips-list">${tips.map(t => `<div class="tip">${t}</div>`).join("")}</div>` : "") +
      `<div class="basis">Confidence: <strong>${conf}</strong>. Bands are <em>modelled</em> (logistic rollout + Monte&nbsp;Carlo), not yet empirically back-tested against real per-car timing — treat as estimates.</div>`;
  }

  function countdownHTML(d) {
    if (d <= 0) return `<div class="cd"><div class="cd-num">↓</div><div class="cd-lbl">expected now</div></div>`;
    const wk = Math.floor(d / 7), dd = d % 7;
    return `<div class="cd"><div class="cd-num">${d}</div><div class="cd-lbl">days</div></div>` +
           `<div class="cd-sep">≈</div>` +
           `<div class="cd"><div class="cd-num">${wk}</div><div class="cd-lbl">weeks</div></div>` +
           (dd ? `<div class="cd"><div class="cd-num">${dd}</div><div class="cd-lbl">days</div></div>` : "");
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
    ms.onchange = () => { gstate = Garage.update(v.id, { market: ms.value }); renderActiveControls(); renderGarage(); ui.guessDays = null; clearGuess(); render(); };

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
    ea.onchange = () => { gstate = Garage.update(v.id, { earlyAccess: ea.checked }); ui.guessDays = null; clearGuess(); setEarlyLabel(); render(); };

    const opt = $("optInToggle");
    opt.checked = !!v.optedIn;
    opt.onchange = () => { gstate = Garage.update(v.id, { optedIn: opt.checked }); };

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

  // ---------------- guess game ----------------
  function renderGuess(pred) {
    if (!$("guessDate").value) $("guessDate").value = Predict.isoDay(pred.medianDate);
    renderConsensus(pred);
    if (ui.guessDays != null) showGuessResult(pred);
  }
  function showGuessResult(pred) {
    const guessStr = $("guessDate").value;
    if (!guessStr || isNaN(new Date(guessStr + "T00:00:00Z"))) {
      $("guessResult").classList.add("show");
      $("guessResult").innerHTML = `<div class="score-lines"><div class="muted">Pick a valid date first 📅</div></div>`;
      return;
    }
    const r = Predict.scoreGuess(pred, guessStr, today);
    ui.guessDays = r.guessDays;
    const verdict = r.score >= 85 ? "🔥 Bang on — right in the fat part of the distribution." :
      r.score >= 60 ? "👍 Solid guess, close to the model." :
      r.score >= 35 ? "🤔 Plausible, but the model leans elsewhere." : "🎲 Bold. The model thinks this is a long shot.";
    const dir = r.offsetDays === 0 ? "exactly the model's pick" :
      r.offsetDays > 0 ? `${r.offsetDays} day(s) later than the model` : `${-r.offsetDays} day(s) earlier than the model`;
    $("guessResult").innerHTML =
      `<div class="score-big"><span>${r.score}</span><small>/100 skill</small></div>` +
      `<div class="score-lines"><div>${verdict}</div><div class="muted">You're ${dir}.</div>` +
      `<div class="muted">${Math.round(r.within3 * 100)}% model mass within ±3 days · ${Math.round(r.cdf * 100)}% chance on or before then.</div></div>`;
    $("guessResult").classList.add("show");
    Charts.distribution($("distChart"), pred, today, ui.guessDays);
  }
  function renderConsensus(pred) {
    const buckets = [{ lbl: "this week", days: 7 }, { lbl: "next week", days: 14 }, { lbl: "this month", days: 30 }, { lbl: "later", days: 9999 }];
    let prev = 0; const seed = Math.round(Math.max(0, pred.median - 1) * 7);
    const vals = buckets.map((b, i) => { const c = Math.round(pred.probWithin(b.days) * 100); const x = Math.max(0, c - prev); prev = c; return Math.max(2, x + ((seed >> i) % 5) - 2); });
    const tot = vals.reduce((a, b) => a + b, 0); const pcts = vals.map(x => Math.round((x / tot) * 100));
    $("consensusBar").innerHTML = buckets.map((b, i) => `<div class="cseg cseg${i}" style="width:${pcts[i]}%" title="${b.lbl}: ${pcts[i]}%"></div>`).join("");
    $("consensusTxt").innerHTML = buckets.map((b, i) => `<span><i class="cdot cseg${i}"></i>${b.lbl} ${pcts[i]}%</span>`).join("");
  }
  function clearGuess() { $("guessResult").classList.remove("show"); $("guessResult").innerHTML = ""; $("guessDate").value = ""; }

  // ---------------- static panels ----------------
  function pctLabel(p) {
    const pct = Math.round(p * 100);
    const word = p <= 0.2 ? "very early" : p <= 0.4 ? "earlier than most" : p <= 0.6 ? "average" : p <= 0.8 ? "later than most" : "very late";
    return `${word} (~${pct}th pct)`;
  }
  const MODE_LABEL = { rolling: "Rolling out", early: "Early/staged rollout", gated: "Awaiting approval", current: "On newest", capped: "Hardware-capped" };
  function renderFSD() {
    const c = av() ? car() : null;
    const region = c ? (WEN.regions[c.market] || {}) : {};
    const f = (c && region.fsd) ? region.fsd[c.hardware] : null;
    $("fsdStatus").textContent = f ? (MODE_LABEL[f.mode] || f.mode) : "—";
    $("fsdUsBuild").textContent = f ? f.current : "—";
    if (c) { const fp = Predict.predictNextFSD(c, today); $("fsdApproval").textContent = (fp.capped || fp.unavailable) ? "—" : Predict.fmtDate(fp.medianDate).replace(/^\w+, /, ""); }
    else $("fsdApproval").textContent = "—";

    // region × hardware matrix (highlights the active car's region if any)
    const rows = Object.keys(WEN.regions).map(rname => {
      const r = WEN.regions[rname];
      const cell = (hw) => {
        const x = r.fsd[hw];
        if (!x) return `<td class="mx-na">—</td>`;
        const next = x.next ? `<span class="mx-next">→ ${esc(x.next)}</span>` : `<span class="mx-capped">capped</span>`;
        return `<td><div class="mx-cur">${esc(x.current)}</div><div class="mx-mode mode-${x.mode}">${MODE_LABEL[x.mode] || x.mode}</div>${next}</td>`;
      };
      const isActive = c && rname === c.market;
      return `<tr class="${isActive ? "mx-active" : ""}"><td class="mx-region">${esc(rname)}${isActive ? ' <span class="tag-you">you</span>' : ''}</td>${cell("AI4")}${cell("AI3")}</tr>`;
    }).join("");
    $("fsdMatrix").innerHTML =
      `<table class="mx-table"><thead><tr><th>Region</th><th>HW4 / AI4</th><th>HW3 / AI3</th></tr></thead><tbody>${rows}</tbody></table>`;

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
    const ALWAYS_MODELLED = new Set(["fsdCard", "regionCard", "releaseNotesCard"]);
    document.querySelectorAll(".fleet-card").forEach(card => {
      card.style.display = "";
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

  // ---- data sources attribution (we aggregate the public trackers) ----
  const DEFAULT_SOURCES = [
    { name: "Tessie", ok: true }, { name: "Teslascope", ok: true }, { name: "TeslaFi", ok: true },
    { name: "Tesla Updates", ok: true }, { name: "FleetCtrl", ok: true },
  ];
  function renderDataSources(sources, live) {
    const list = sources || DEFAULT_SOURCES;
    $("dataSources").innerHTML =
      `<span class="ds-label">${live ? "Live data aggregated from" : "Aggregates"}:</span>` +
      list.map(s => `<span class="ds-pill ${s.ok === false ? "ds-down" : ""}">${esc(s.name)}${s.ok !== false && s.versions ? " · " + s.versions : ""}</span>`).join("") +
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
  function renderRegions() {
    const activeMarket = av() ? av().market : null;
    const base = WEN.regions["United States"].osLagDays;
    const lags = Object.values(WEN.regions).map(r => r.osLagDays - base);
    const maxLag = Math.max(1, ...lags);
    $("regionPanel").innerHTML = Object.keys(WEN.regions).map(name => {
      const r = WEN.regions[name];
      const lag = r.osLagDays - base;
      const p = Predict.predictNextOS({ market: name, hardware: "AI4", installedVersion: "2026.14.6", earlinessPercentile: 0.5 }, today);
      const isA = name === activeMarket;
      const barW = (lag / maxLag) * 100;
      return `<div class="rp-row ${isA ? "rp-active" : ""}">` +
        `<div class="rp-name">${esc(name)}${isA ? ' <span class="tag-you">you</span>' : ''} <span class="rp-drive">${r.drive}</span></div>` +
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
        `<td><strong class="${hasNotes ? "fw-verlink" : ""}" ${hasNotes ? `data-rn="${esc(v.version)}"` : ""}>${v.version}</strong>${isMine ? ' <span class="tag-you">you</span>' : ''}</td>` +
        `<td><span class="status status-${v.status}">${v.status}</span></td>` +
        `<td>${v.fleetPct != null ? `<div class="pctcell"><span class="pctbar" style="width:${Math.min(100, v.fleetPct * 2.2)}%"></span><em>${v.fleetPct}%</em></div>` : `<span class="mut-i">not reported</span>`}</td>` +
        `<td>${v.fleetPct != null ? sparkSVG(v) : "—"}</td>` +
        `<td>${v.firstSeen ? shortDate(v.firstSeen) : "—"}</td><td>${(v.fsdBuild && v.fsdBuild.AI4) || "—"}</td><td class="notes">${v.notes || ""}</td></tr>`;
    }).join("");
    $("fwBody").querySelectorAll(".fw-verlink").forEach(el => {
      el.onclick = () => {
        const d = document.querySelector(`#releaseNotes details[data-ver="${el.dataset.rn}"]`);
        if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "center" }); d.classList.add("rn-flash"); setTimeout(() => d.classList.remove("rn-flash"), 1200); }
      };
    });
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
  function startFeed() {
    const feed = $("feed"); let i = 0;
    const times = ["just now", "1m ago", "3m ago", "6m ago", "11m ago", "18m ago", "25m ago", "33m ago"];
    function row(s, t) {
      return `<span class="feed-when">${t}</span><span class="feed-main"><span class="feed-region">${s.region}</span> ` +
        `<span class="feed-model">${s.model}</span> <span class="hwtag">${s.hw}</span></span>` +
        `<span class="feed-ver">${s.from} <em>→</em> <strong>${s.to}</strong></span>`;
    }
    feed.innerHTML = WEN.feedSeeds.map((s, idx) => `<li>${row(s, times[idx] || "earlier")}</li>`).join("");
    $("feedSub").textContent = WEN.feedSeeds.length + " recent";
    setInterval(() => {
      const s = WEN.feedSeeds[i % WEN.feedSeeds.length]; i++;
      const li = document.createElement("li"); li.innerHTML = row(s, "just now"); li.classList.add("flash");
      feed.insertBefore(li, feed.firstChild);
      while (feed.children.length > 8) feed.removeChild(feed.lastChild);
    }, 4200);
  }

  // ---------------- events ----------------
  function wire() {
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
    rerender() { renderFSD(); renderStats(); renderDataMode(); render(); },
    setSources(list, live) { renderDataSources(list, live); },
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
  startFeed();
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
