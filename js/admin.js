/* wenFSD — creator-only dashboard. Token-gated; talks to /api/admin/stats. No third parties. */
(function () {
  const $ = (id) => document.getElementById(id);
  const app = $("adminApp");
  const KEY = "wenfsd_admin_token";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function gate() {
    const saved = sessionStorage.getItem(KEY) || "";
    app.innerHTML =
      `<div class="card" style="max-width:460px">` +
      `<label class="field"><span>Admin token</span>` +
      `<input type="password" id="adminTok" placeholder="paste your ADMIN_TOKEN" value="${esc(saved)}" autocomplete="off"/></label>` +
      `<button class="btn" id="adminGo" style="margin-top:10px">Show me the numbers 📊</button>` +
      `<p class="hint" id="adminErr" style="color:var(--acc2);margin-top:10px"></p>` +
      `</div>`;
    $("adminGo").onclick = load;
    $("adminTok").onkeydown = (e) => { if (e.key === "Enter") load(); };
  }

  function load() {
    const tok = ($("adminTok") ? $("adminTok").value : sessionStorage.getItem(KEY) || "").trim();
    if (!tok) return;
    sessionStorage.setItem(KEY, tok);
    app.innerHTML = `<p class="hint">Counting your adoring public… 🫶</p>`;
    fetch("/api/admin/stats", { headers: { "x-admin-token": tok, Accept: "application/json" } })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || ("HTTP " + r.status))))
      .then(d => { render(d); loadEvents(tok); })
      .catch(err => { gate(); const e = $("adminErr"); if (e) e.textContent = "✗ " + (typeof err === "string" ? err : "couldn't load") + ". Wrong token, or ADMIN_TOKEN isn't set on the server."; });
  }

  // --- rollout-event review queue: confirm/dismiss is the HUMAN GATE before events go public ---
  function loadEvents(tok) {
    fetch("/api/admin/events", { headers: { "x-admin-token": tok, Accept: "application/json" } })
      .then(r => r.ok ? r.json() : null).then(d => renderEvents(d && d.events || [], tok)).catch(() => {});
  }
  function evRow(e, tok) {
    const pend = e.status === "pending";
    const meta = [e.version || "next build", e.region || "global", e.source, `conf ${Math.round((e.confidence || 0) * 100)}%`].filter(Boolean).map(esc).join(" · ");
    const btns = pend
      ? `<button class="btn-sm" data-ev-confirm="${e.id}" style="background:rgba(55,214,122,.16);border-color:rgba(55,214,122,.4);color:#7fe0b8">✓ Confirm (go live)</button>
         <button class="btn-sm" data-ev-dismiss="${e.id}" style="margin-left:6px">✕ Dismiss</button>`
      : `<span class="rp-eta" style="opacity:.7">${esc(e.status)}</span>`;
    return `<div class="rp-row" style="align-items:flex-start;gap:10px">
      <div class="rp-name" style="min-width:84px"><strong>${esc((e.type || "").toUpperCase())}</strong></div>
      <div style="flex:1"><div>${meta}</div>${e.reason ? `<div class="cal-sub">${esc(e.reason)}</div>` : ""}</div>
      <div style="white-space:nowrap">${btns}</div></div>`;
  }
  function renderEvents(events, tok) {
    const host = $("adminEvents"); if (!host) return;
    const pending = events.filter(e => e.status === "pending");
    const recent = events.filter(e => e.status !== "pending").slice(0, 8);
    document.title = (pending.length ? `(${pending.length}) ` : "") + "wenFSD · creator dashboard";   // tab badge
    host.innerHTML =
      `<h2 class="card-h" style="margin:22px 0 10px">Rollout events <span class="card-sub">${pending.length} awaiting your confirmation — nothing goes public until you approve it</span></h2>` +
      `<div class="card"><div class="region-panel">` +
      (pending.length ? pending.map(e => evRow(e, tok)).join("") : `<p class="hint">No pending events. Quiet skies. ✈️</p>`) +
      (recent.length ? `<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">` + recent.map(e => evRow(e, tok)).join("") : "") +
      `</div><p class="hint" style="margin-top:10px">Confirmed events overlay the public prediction (freeze + honest "paused"). Pending observed/community signals never do until confirmed here.</p></div>`;
    host.querySelectorAll("[data-ev-confirm]").forEach(b => b.onclick = () => patchEvent(b.getAttribute("data-ev-confirm"), "confirmed", tok));
    host.querySelectorAll("[data-ev-dismiss]").forEach(b => b.onclick = () => patchEvent(b.getAttribute("data-ev-dismiss"), "dismissed", tok));
  }
  function patchEvent(id, status, tok) {
    fetch("/api/admin/events/" + encodeURIComponent(id), { method: "PATCH", headers: { "x-admin-token": tok, "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
      .then(r => r.ok ? loadEvents(tok) : null).catch(() => {});
  }

  function tile(big, label, sub) {
    return `<div class="cal-tile"><div class="cal-big">${esc(big)}</div><div class="cal-h" style="margin-top:4px">${esc(label)}</div>${sub ? `<div class="cal-sub">${esc(sub)}</div>` : ""}</div>`;
  }
  function barRows(rows, labelKey, valKeys) {
    if (!rows || !rows.length) return `<p class="hint">No data yet. The internet hasn't found you. Post the link. 📣</p>`;
    const max = Math.max(1, ...rows.map(r => Math.max(...valKeys.map(k => +r[k] || 0))));
    return `<div class="region-panel">` + rows.map(r => {
      const lbl = esc(r[labelKey]);
      const segs = valKeys.map(k => {
        const v = +r[k] || 0;
        return `<span class="rp-eta">${esc(k)}: <strong>${v.toLocaleString()}</strong></span><div class="rp-bar"><span style="width:${Math.max(2, (v / max) * 100)}%"></span></div>`;
      }).join("");
      return `<div class="rp-row"><div class="rp-name">${lbl}</div>${segs}</div>`;
    }).join("") + `</div>`;
  }

  // the growth funnel: events in logical order so you read activation → retention → referral
  const FUNNEL_ORDER = [
    ["prediction_generated", "🎯 Got a prediction (activation)"],
    ["demo_loaded", "🚗 Loaded the demo"],
    ["email_subscribed", "📭 Captured an email (no-login)"],
    ["connect_clicked", "🔗 Clicked Connect Tesla"],
    ["notify_enabled", "🔔 Enabled live notify"],
    ["history_logged", "📅 Logged update history"],
    ["bet_placed", "🎲 Placed a Call-Your-Shot bet"],
    ["shared", "📣 Shared a prediction"],
  ];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) + "%" : "—";
  function funnelSection(funnel) {
    funnel = funnel || {};
    const base = +funnel.prediction_generated || 0;   // activation is the conversion denominator
    const rows = FUNNEL_ORDER.map(([k, label]) => ({ k, label, n: +funnel[k] || 0 }));
    const max = Math.max(1, ...rows.map(r => r.n));
    const bars = rows.map(r =>
      `<div class="rp-row"><div class="rp-name">${esc(r.label)}</div>` +
      `<div class="rp-bar"><span style="width:${Math.max(2, (r.n / max) * 100)}%"></span></div>` +
      `<div class="rp-eta"><strong>${r.n.toLocaleString()}</strong>${r.k !== "prediction_generated" ? ` <span style="color:var(--mut)">· ${pct(r.n, base)} of activations</span>` : ""}</div></div>`).join("");
    return `<h2 class="card-h" style="margin:22px 0 10px">Funnel <span class="card-sub">events, last 30 days</span></h2>` +
      `<div class="card"><div class="region-panel">${bars}</div>` +
      `<p class="hint" style="margin-top:10px">Cookieless aggregate counts (no user IDs). Activation = got a prediction; downstream rows show their conversion off activation.</p></div>`;
  }

  // roll the dimensioned rows up by one dimension → { key: { event: n } }
  function rollup(dims, dim) {
    const out = {};
    for (const r of (dims || [])) { const k = r[dim] || "?"; (out[k] = out[k] || {})[r.event] = (out[k][r.event] || 0) + (+r.n || 0); }
    return out;
  }
  function convTable(title, sub, roll) {
    const keys = Object.keys(roll).sort((a, b) => (roll[b].prediction_generated || 0) - (roll[a].prediction_generated || 0));
    if (!keys.length) return "";
    const th = (t) => `<th style="text-align:left;padding:6px 10px;color:var(--mut);font-weight:600">${t}</th>`;
    const td = (t, strong) => `<td style="padding:6px 10px;border-top:1px solid var(--line)">${strong ? `<strong>${t}</strong>` : t}</td>`;
    const body = keys.map(k => {
      const e = roll[k], act = e.prediction_generated || 0;
      const alerts = (e.notify_enabled || 0) + (e.email_subscribed || 0);
      return `<tr>${td(esc(k), true)}${td(act.toLocaleString())}${td(pct(e.shared || 0, act))}${td(pct(alerts, act))}${td(pct(e.connect_clicked || 0, act))}</tr>`;
    }).join("");
    return `<h2 class="card-h" style="margin:22px 0 10px">${esc(title)} <span class="card-sub">${esc(sub)}</span></h2>` +
      `<div class="card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">` +
      `<thead><tr>${th(title.indexOf("variant") !== -1 ? "variant" : "source")}${th("activations")}${th("share rate")}${th("alert rate")}${th("connect rate")}</tr></thead>` +
      `<tbody>${body}</tbody></table></div>`;
  }
  function breakdownSection(dims) {
    if (!dims || !dims.length) return "";
    return convTable("Activation by source", "which channel converts (off activations)", rollup(dims, "source")) +
      convTable("A/B: primary CTA (by variant)", "a = “See my prediction” · b = “Predict my next update”", rollup(dims, "variant"));
  }
  function render(d) {
    const sample = d.mode === "sample";
    const totViews = (d.visitsByDay || []).reduce((a, b) => a + (+b.views || 0), 0);
    const totUniques = (d.visitsByDay || []).reduce((a, b) => a + (+b.uniques || 0), 0);
    app.innerHTML =
      (sample ? `<div class="sample-banner" style="margin:0 0 14px">⚠️ <strong>Sample numbers</strong> — the server is in mock mode or has no database. These are fake so you can see the layout. Real figures appear once the live DB is connected.</div>` : "") +
      `<div class="cal-grid">` +
        tile((d.signups || 0).toLocaleString(), "signups (Tesla accounts linked)", `${(d.usersWithEmail || 0)} shared an email`) +
        tile((d.vehicles || 0).toLocaleString(), "cars linked", `${(d.optedIn || 0)} opted into sharing`) +
        tile(totUniques.toLocaleString(), "unique visitors (last 30d)", `${totViews.toLocaleString()} page views`) +
        tile((d.guesses || 0).toLocaleString(), "shots called", `${(d.guessesSettled || 0)} settled · ${(d.griefLogs || 0)} grief logs`) +
        tile((d.emailSubscribers || 0).toLocaleString(), "email subscribers (no-login)", `${(d.emailConfirmed || 0)} confirmed`) +
      `</div>` +
      `<div id="adminEvents"></div>` +
      funnelSection(d.funnel) +
      breakdownSection(d.funnelDims) +
      `<h2 class="card-h" style="margin:22px 0 10px">Signups by region <span class="card-sub">where your people are</span></h2>` +
      `<div class="card">${barRows(d.byRegion, "market", ["n"])}</div>` +
      `<h2 class="card-h" style="margin:22px 0 10px">Traffic <span class="card-sub">views &amp; rough uniques, by day</span></h2>` +
      `<div class="card">${dayTable(d.visitsByDay, ["views", "uniques"])}</div>` +
      `<h2 class="card-h" style="margin:22px 0 10px">New signups <span class="card-sub">by day</span></h2>` +
      `<div class="card">${dayTable(d.signupsByDay, ["n"])}</div>` +
      `<p class="hint" style="margin-top:18px">🔒 Visit counts are cookieless: a salted daily hash of IP+user-agent (not the IP itself), pruned after 90 days. Refresh to update. <a href="/" style="color:var(--cyan)">← back to the site</a></p>` +
      `<button class="btn-sm" id="adminLogout" style="margin-top:8px">Forget my token (this device)</button>`;
    $("adminLogout").onclick = () => { sessionStorage.removeItem(KEY); gate(); };
  }
  function dayTable(rows, valKeys) {
    if (!rows || !rows.length) return `<p class="hint">Nothing logged yet. Either nobody's visited or the counter just woke up. ☕</p>`;
    const max = Math.max(1, ...rows.map(r => +r[valKeys[0]] || 0));
    return `<div class="region-panel">` + rows.map(r => {
      const v = +r[valKeys[0]] || 0;
      const extra = valKeys.slice(1).map(k => `${esc(k)} ${(+r[k] || 0).toLocaleString()}`).join(" · ");
      return `<div class="rp-row"><div class="rp-name" style="font-family:var(--mono)">${esc(r.day)}</div>` +
        `<div class="rp-bar"><span style="width:${Math.max(2, (v / max) * 100)}%"></span></div>` +
        `<div class="rp-eta"><strong>${v.toLocaleString()}</strong>${extra ? " · " + esc(extra) : ""}</div></div>`;
    }).join("") + `</div>`;
  }

  // auto-load if a token is already remembered this session
  if (sessionStorage.getItem(KEY)) load(); else gate();
})();
