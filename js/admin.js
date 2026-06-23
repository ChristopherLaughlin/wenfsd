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
      .then(render)
      .catch(err => { gate(); const e = $("adminErr"); if (e) e.textContent = "✗ " + (typeof err === "string" ? err : "couldn't load") + ". Wrong token, or ADMIN_TOKEN isn't set on the server."; });
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
