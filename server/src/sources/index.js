// wenFSD external data ingestion — pulls firmware/version data from the public Tesla
// trackers and merges it into one consensus view. We rely on these because we don't yet
// have our own large fleet; owners are unlikely to leave their existing tracker.
//
// Each adapter returns normalized rows; we fleet-WEIGHT the adoption %s (a 630k-car
// source counts far more than a 13k one), take the earliest first-seen, union release
// notes, and record which sources contributed. Wire each adapter's fetchLive() to the
// real source (respecting each site's ToS / robots.txt / partner terms) before launch.
import { teslafi } from "./teslafi.js";
import { teslascope, fetchNotes } from "./teslascope.js";
import { tessie } from "./tessie.js";
import { teslaupdates } from "./teslaupdates.js";
import { fleetctrl } from "./fleetctrl.js";
import { verKey } from "../wendata.js";

export const SOURCES = [tessie, teslascope, teslaupdates, teslafi, fleetctrl];

export async function fetchAll({ live = false } = {}) {
  const results = await Promise.allSettled(SOURCES.map(s => s.fetch({ live })));
  return SOURCES.map((s, i) => ({
    source: s,
    ok: results[i].status === "fulfilled",
    rows: results[i].status === "fulfilled" ? results[i].value : [],
    error: results[i].status === "rejected" ? String(results[i].reason && results[i].reason.message || results[i].reason) : null,
  }));
}

// Merge per-version across sources. Returns rows sorted newest-first.
export async function merge({ live = false } = {}) {
  const fetched = await fetchAll({ live });
  const byVer = new Map();
  for (const { source, ok, rows } of fetched) {
    if (!ok) continue;
    for (const r of rows) {
      let m = byVer.get(r.version);
      if (!m) { m = { version: r.version, firstSeen: r.firstSeen || null, branch: r.branch || "standard", _w: 0, _pct: 0, recentInstalls: 0, sources: [], fsdBuild: {}, status: null, regions: new Set(), notes: [] }; byVer.set(r.version, m); }
      if (r.fleetPct != null && source.fleet > 0) { m._pct += r.fleetPct * source.fleet; m._w += source.fleet; }
      if (r.recentInstalls != null) m.recentInstalls += r.recentInstalls;
      if (r.firstSeen && (!m.firstSeen || r.firstSeen < m.firstSeen)) m.firstSeen = r.firstSeen;
      if (r.status && !m.status) m.status = r.status;
      if (r.fsd) Object.assign(m.fsdBuild, r.fsd);
      if (r.regions) r.regions.forEach(x => m.regions.add(x));
      if (r.notes) m.notes.push(...r.notes);
      m.sources.push(source.name);
    }
  }
  const merged = [...byVer.values()].map(m => ({
    version: m.version,
    fleetPct: m._w > 0 ? Math.round((m._pct / m._w) * 10) / 10 : null,
    recentInstalls: m.recentInstalls || null,
    firstSeen: m.firstSeen,
    branch: m.branch,
    status: m.status,
    fsdBuild: Object.keys(m.fsdBuild).length ? m.fsdBuild : null,
    regions: [...m.regions],
    notes: m.notes,
    sources: [...new Set(m.sources)],
    sourceCount: new Set(m.sources).size,
  }));
  merged.sort((a, b) => verKey(b.version) - verKey(a.version));
  return merged;
}

// Push merged consensus into the DB (real mode). Safe no-op pattern if no DB.
export async function refreshAll(db, { live = false } = {}) {
  const merged = await merge({ live });
  if (db && db.hasDb && db.hasDb()) {
    for (const v of merged) {
      await db.query(
        `INSERT INTO firmware_versions(version, branch, first_seen, fleet_pct, updated_at)
         VALUES($1,$2,$3,$4, now())
         ON CONFLICT(version) DO UPDATE SET fleet_pct=COALESCE($4, firmware_versions.fleet_pct),
           first_seen=COALESCE(firmware_versions.first_seen,$3), updated_at=now()`,
        [v.version, v.branch, v.firstSeen, v.fleetPct]);
    }
  }
  return merged;
}

// Real release notes for the most recent versions (Teslascope). Bounded to `limit` versions
// to keep request volume low; callers cache heavily (notes change rarely once published).
export async function fetchReleaseNotes({ live = false, limit = 6 } = {}) {
  if (!live) return {};
  const merged = await merge({ live: true });
  const recent = merged.slice(0, limit);
  const out = {};
  await Promise.allSettled(recent.map(async (v) => {
    const items = await fetchNotes(v.version);
    if (items && items.length) {
      out[v.version] = {
        date: v.firstSeen || null,
        regions: v.regions || [],
        fsd: v.fsdBuild && v.fsdBuild.AI4 ? v.fsdBuild.AI4 : null,
        source: "Teslascope",
        items,
      };
    }
  }));
  return out;
}

export function sourceStatus(fetched) {
  return fetched.map(f => ({ name: f.source.name, homepage: f.source.homepage, fleet: f.source.fleet, ok: f.ok, versions: f.rows.length, error: f.error }));
}
