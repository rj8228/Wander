/* Wander: the map starts dark; walking, driving and trips uncover it. Everything stays on this phone.
   app.js holds state, storage, the tracking pipeline, places, trips and the map. ui.js draws the screens, cards.js the share images. */
"use strict";
const C = window.WanderCore;
const VERSION = self.WANDER_VERSION || "0";
const N = window.WanderNative || null; // the Android bridge; absent in a browser
const KEY = "wander-v1";
const APK_URL = "https://github.com/rj8228/Wander/releases/download/latest/Wander.apk";
const WEB_URL = "https://rj8228.github.io/Wander/";
const COMPARE_BASE = "https://rj8228.github.io/Wander/c#";
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const NOMINATIM = "https://nominatim.openstreetmap.org";
// Reveal radii in grid units (multiples of the hex size), so a walk always clears a trail 2-3 cells wide at any latitude.
const WALK_R = 1.55, DRIVE_R = 0.75, FIRST_R = 3.05, FOUND_R = 150, TRIP_KM = 50, HOME_BACK_KM = 30, WALK_MAX = 3.2, CITY_KM = 14;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => Date.now();
const pad2 = n => String(n).padStart(2, "0");
const dayKey = (t = now()) => { const d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
const dayDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const uid = () => Math.random().toString(36).slice(2, 9) + now().toString(36).slice(-4);
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = t => { const d = new Date(t); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };
const fmtTime = t => { const d = new Date(t); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
const plural = (n, one, many) => n + " " + (n === 1 ? one : (many || one + "s"));

/* ---------- place categories and photo ideas (title, how-to, pose guide) ---------- */
const CATS = {
  viewpoint: { one: "Viewpoint", many: "Viewpoints", a: "A viewpoint", ideas: [
    ["Silhouette at the rail", "Sun behind you, phone low, tap your face to expose for the sky.", "figure"],
    ["The wide view", "Step back and keep the horizon on the lower third line.", "horizon"],
    ["Frame it", "Shoot the view through a railing, branch or arch.", "frame"]] },
  cafe: { one: "Café", many: "Cafés", a: "A café", ideas: [
    ["Your cup, from above", "Phone flat over the table, cup a little off-centre.", "detail"],
    ["Window seat", "Sit facing the window and let it light your face.", "sit"],
    ["The counter", "The counter or menu board, shot from your seat.", "thirds"]] },
  park: { one: "Park", many: "Parks", a: "A park", ideas: [
    ["Under the big tree", "Stand at the trunk, phone low, shoot up into the branches.", "figure"],
    ["Path leading in", "Put the path in a bottom corner so it leads into the photo.", "thirds"],
    ["On the grass", "Sit down, horizon level, sky in the top third.", "sit"]] },
  museum: { one: "Museum", many: "Museums", a: "A museum", ideas: [
    ["The entrance", "The whole entrance and its name in one frame.", "thirds"],
    ["Your favourite piece", "Fill the frame with the one thing you loved. No flash.", "detail"],
    ["Tiny you, big hall", "Stand far from the camera in the biggest room.", "figure"]] },
  landmark: { one: "Landmark", many: "Landmarks", a: "A landmark", ideas: [
    ["Tiny you, big landmark", "Stand well in front, phone low, the whole landmark in frame.", "figure"],
    ["One detail", "Get close to a carving, plaque or texture.", "detail"],
    ["From across the street", "Use the street as a frame, landmark on a third line.", "thirds"]] },
  art: { one: "Street art", many: "Street art", a: "A piece of street art", ideas: [
    ["Step into it", "Stand where you become part of the art.", "figure"],
    ["Close-up", "Fill the frame with the best detail.", "detail"],
    ["With the street", "Step back so the art and the street share the frame.", "thirds"]] },
  market: { one: "Market", many: "Markets", a: "A market", ideas: [
    ["Colour stall", "Fill the frame with fruit, spices or flowers.", "detail"],
    ["What you bought", "Hold it up with the stalls behind.", "figure"],
    ["The crowd", "Shoot from a step or bridge, people in the lower half.", "horizon"]] }
};
const CAT_ORDER = Object.keys(CATS);
const CAT_CAP = { viewpoint: 25, cafe: 30, park: 25, museum: 15, landmark: 25, art: 15, market: 8 };

/* ---------- state ---------- */
function defaults() {
  return { v: 1, created: now(), intro: false, firstFix: null, firstCells: 0, askedBg: false, quietAsked: false,
    cells: "", drive: "", days: {}, track: { d: "", pts: [] }, last: null, home: null, quiet: [], places: {}, pq: [], photos: {},
    trips: [], tripId: null, geo: {}, homeCity: null, paused: 0, theme: "day", tracking: "smart",
    notif: { place: true, streak: true, recap: true }, lastBackup: 0, name: "", newTile: null, legendSeen: "", nights: {}, homeAsk: 0,
    offline: {}, stats: { walk: 0, drive: 0 } };
}
let S = defaults();
let WALK = new Set(), DRIVE = new Set();
const TS = new Map(); // trip id -> { all: Set, days: { day: Set } }
let cellsVersion = 1, saveTimer = 0, WIPED = false;

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { raw = null; }
  S = Object.assign(defaults(), raw || {});
  S.notif = Object.assign(defaults().notif, S.notif || {});
  S.stats = Object.assign(defaults().stats, S.stats || {});
  try { WALK = new Set(C.decodeCells(S.cells)); DRIVE = new Set(C.decodeCells(S.drive)); } catch (e) { WALK = new Set(); DRIVE = new Set(); }
  TS.clear();
  for (const t of S.trips) {
    const days = {};
    for (const [d, enc] of Object.entries(t.dayCells || {})) days[d] = new Set(C.decodeCells(enc));
    TS.set(t.id, { all: new Set(C.decodeCells(t.cells || "")), days });
  }
  cellsVersion++;
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
function saveNow() {
  clearTimeout(saveTimer);
  if (WIPED) return;
  S.cells = C.encodeCells(WALK); S.drive = C.encodeCells(DRIVE);
  for (const t of S.trips) {
    const ts = TS.get(t.id); if (!ts) continue;
    t.cells = C.encodeCells(ts.all);
    t.dayCells = {}; for (const [d, set] of Object.entries(ts.days)) t.dayCells[d] = C.encodeCells(set);
  }
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Storage is full. Export a backup in Me → Settings."); }
}
addEventListener("pagehide", () => saveNow());

/* ---------- photos live in IndexedDB (a downsized copy + thumbnail); the originals stay in the gallery ---------- */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("wander", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("photos", mode); const st = t.objectStore("photos"); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); },
  put(p) { return this.tx("readwrite", st => st.put(p)); },
  get(id) { return this.tx("readonly", st => st.get(id)); },
  del(id) { return this.tx("readwrite", st => st.delete(id)); },
  all() { return this.tx("readonly", st => st.getAll()); },
  clear() { return this.tx("readwrite", st => st.clear()); }
};
const THUMBS = new Map(); // photo id -> thumbnail data URL
async function loadThumbs() { try { for (const p of await DB.all()) THUMBS.set(p.id, p.thumb); } catch (e) { /* private mode */ } }
const thumbOf = id => THUMBS.get(id) || "";
/** class + style attributes for a photo tile: the thumbnail, or a warm gradient when there is none. */
const bgAttr = (id, i, cls = "") => { const t = id ? thumbOf(id) : ""; return t ? `class="${cls}" style="background-image:url('${t}')"` : `class="${cls} ph${((i || 0) % 6) + 1}"`; };
const bgOf = (id, i) => bgAttr(id, i, "");
async function photoBlobURL(id) { try { const p = await DB.get(id); if (p && p.mid) return URL.createObjectURL(p.mid); return p ? p.thumb : ""; } catch (e) { return thumbOf(id); } }

/* ---------- day log, streaks, stats ---------- */
function dayLog(t) { const k = dayKey(t); return S.days[k] || (S.days[k] = { n: 0, w: 0, dr: 0, got: [] }); }
function streak() {
  const d = new Date(); let n = 0;
  if (!((S.days[dayKey(d)] || {}).n > 0)) d.setDate(d.getDate() - 1);
  while ((S.days[dayKey(d)] || {}).n > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function longestStreak() {
  const ks = Object.keys(S.days).filter(k => S.days[k].n > 0).sort(); let best = 0, run = 0, prev = null;
  for (const k of ks) { const d = dayDate(k); run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
const todayNew = () => (S.days[dayKey()] || {}).n || 0;
function areaKm2() { let a = 0; for (const k of WALK) a += C.cellArea(C.cellLatLng(k)[0]); for (const k of DRIVE) a += C.cellArea(C.cellLatLng(k)[0]); return a / 1e6; }
function boxStatsRaw(box, walk, drive) {
  const x1 = C.mx(box[1]), x2 = C.mx(box[3]), y1 = C.my(box[0]), y2 = C.my(box[2]); let w = 0, d = 0;
  const inb = k => { const c = C.cellXY(k); return c[0] >= x1 && c[0] <= x2 && c[1] >= y1 && c[1] <= y2; };
  for (const k of walk) if (inb(k)) w++;
  if (drive) for (const k of drive) if (inb(k)) d++;
  const total = C.boxCells(box);
  return { w, d, total, pw: 100 * w / total, pd: 100 * d / total, p: 100 * (w + d) / total };
}
let bsCache = { key: "", v: 0, r: null };
function boxStats(box) {
  const key = box.join(",");
  if (bsCache.key === key && bsCache.v === cellsVersion) return bsCache.r;
  const r = boxStatsRaw(box, WALK, DRIVE); bsCache = { key, v: cellsVersion, r }; return r;
}

/* ---------- quiet places and home ---------- */
const quietAt = (lat, lng) => S.quiet.find(q => q.on !== false && C.dist(lat, lng, q.lat, q.lng) <= q.r) || null;
const nearQuiet = (lat, lng, pad) => S.quiet.some(q => q.on !== false && C.dist(lat, lng, q.lat, q.lng) <= q.r + pad);
function homePoint() { const h = S.quiet.find(q => /home/i.test(q.name)) || S.quiet[0]; return h ? { lat: h.lat, lng: h.lng } : S.home; }
const isPaused = (t = now()) => S.paused === -1 || S.paused > t;
function pausedLabel() {
  if (S.paused === -1) return "Paused until you turn it back on";
  const d = new Date(S.paused), td = new Date();
  return "Paused until " + (d.toDateString() === td.toDateString() ? fmtTime(S.paused) : "tomorrow" + (d.getHours() ? " " + fmtTime(S.paused) : ""));
}

/* ---------- the tracking pipeline: every location fix goes through ingest() ---------- */
let lastPt = null, anchor = null, speeds = [], inQuietNow = null, foundQueue = [], firstRevealPending = 0;
function ingest(points, opts = {}) {
  let fresh = 0, any = false;
  for (const p of points) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng)) continue;
    p.t = p.t || now();
    if (S.last && p.t < S.last.t - 1000) continue;
    S.last = { lat: p.lat, lng: p.lng, t: p.t, acc: p.acc || 0 };
    any = true;
    if (isPaused(p.t)) { lastPt = null; anchor = null; continue; }
    if ((p.acc || 0) > (S.firstFix ? 65 : 150)) continue;
    noteNight(p);
    const q = quietAt(p.lat, p.lng);
    if (q && S.tracking !== "always") { inQuietNow = q; lastPt = null; anchor = null; tripCheck(p); continue; }
    inQuietNow = null;
    const first = !S.firstFix;
    let mode = "walk", seg = 0, dt = 0;
    const prev = lastPt;
    if (prev) {
      seg = C.dist(prev.lat, prev.lng, p.lat, p.lng); dt = (p.t - prev.t) / 1000;
      if (dt <= 0) continue;
      if (seg / dt > 75) { lastPt = p; anchor = p; speeds = []; tripCheck(p); continue; } // a flight or a GPS jump
      speeds.push(p.spd != null && p.spd >= 0 ? Math.max(p.spd, seg > 25 ? seg / dt * 0.8 : 0) : seg / dt);
      if (speeds.length > 3) speeds.shift();
      mode = median(speeds) > WALK_MAX ? "drive" : "walk";
    }
    const r = (first ? FIRST_R : mode === "walk" ? WALK_R : DRIVE_R) * C.HEX * Math.cos(p.lat * Math.PI / 180);
    fresh += uncoverAt(p.lat, p.lng, r, mode, p.t);
    if (prev && seg > 20 && seg < 2500 && dt < 900) {
      const steps = Math.ceil(seg / 25);
      for (let i = 1; i < steps; i++) { const f = i / steps; fresh += uncoverAt(prev.lat + (p.lat - prev.lat) * f, prev.lng + (p.lng - prev.lng) * f, r, mode, p.t); }
    }
    if (first) { S.firstFix = { lat: p.lat, lng: p.lng, t: p.t }; S.home = S.home || { lat: p.lat, lng: p.lng }; S.firstCells = WALK.size; firstRevealPending = WALK.size; }
    if (!anchor || p.t - anchor.t > 900000) anchor = p;
    else {
      const da = C.dist(anchor.lat, anchor.lng, p.lat, p.lng);
      if (da >= 15) { const dl = dayLog(p.t); if (mode === "walk") { dl.w += da; S.stats.walk += da; } else { dl.dr += da; S.stats.drive += da; } anchor = p; }
    }
    addTrack(p, mode);
    lastPt = p;
    tripCheck(p);
    placeCheck(p);
  }
  if (any) { save(); afterIngest(fresh); }
  return fresh;
}
function uncoverAt(lat, lng, m, mode, t) {
  let n = 0;
  const trip = S.tripId ? TS.get(S.tripId) : null, dk = dayKey(t);
  for (const k of C.cellsNear(lat, lng, m)) {
    if (mode === "walk") {
      if (!WALK.has(k)) { WALK.add(k); if (!DRIVE.delete(k)) n++; cellsVersion++; }
    } else if (!WALK.has(k) && !DRIVE.has(k)) { DRIVE.add(k); n++; cellsVersion++; }
    if (trip) { trip.all.add(k); (trip.days[dk] || (trip.days[dk] = new Set())).add(k); }
  }
  if (n) dayLog(t).n += n;
  return n;
}
function addTrack(p, mode) {
  const d = dayKey(p.t);
  if (S.track.d !== d) S.track = { d, pts: [] };
  const pts = S.track.pts, l = pts[pts.length - 1];
  if (!l || C.dist(l[0], l[1], p.lat, p.lng) >= 15) { pts.push([+p.lat.toFixed(6), +p.lng.toFixed(6), mode === "walk" ? 1 : 0]); if (pts.length > 4000) pts.splice(0, pts.length - 4000); }
}
function noteNight(p) {
  const h = new Date(p.t).getHours();
  if ((h >= 23 || h < 5) && (p.acc || 0) < 60) S.nights[dayKey(p.t - 6 * 3600e3)] = [+p.lat.toFixed(5), +p.lng.toFixed(5)];
  const ks = Object.keys(S.nights); if (ks.length > 7) delete S.nights[ks.sort()[0]];
}

/* ---------- places: Overpass, cached in state ---------- */
function classify(t) {
  if (t.tourism === "viewpoint") return "viewpoint";
  if (t.amenity === "cafe") return "cafe";
  if (t.leisure === "park" || t.leisure === "garden") return "park";
  if (t.tourism === "museum" || t.tourism === "gallery") return "museum";
  if (t.tourism === "artwork") return "art";
  if (t.amenity === "marketplace") return "market";
  if (t.historic || t.tourism === "attraction") return "landmark";
  return null;
}
let placesBusy = false, placesFailAt = 0;
function overpassQuery(area, limit) {
  const parts = ['nwr["tourism"="viewpoint"]', 'nwr["amenity"="cafe"]["name"]', 'nwr["leisure"~"^(park|garden)$"]["name"]', 'nwr["tourism"~"^(museum|gallery)$"]["name"]',
    'nwr["historic"~"^(monument|memorial|castle|fort|ruins|city_gate|archaeological_site)$"]["name"]', 'nwr["tourism"="attraction"]["name"]', 'nwr["tourism"="artwork"]', 'nwr["amenity"="marketplace"]'];
  return "[out:json][timeout:25];(" + parts.map(p => p + area + ";").join("") + ");out center tags " + limit + ";";
}
async function overpass(q) {
  let last;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (r.ok) return await r.json();
      last = new Error("Overpass " + r.status);
    } catch (e) { last = e; }
  }
  throw last;
}
/** Fetch places around a point (or in a box), keep the nearest few per category, merge into state. Returns how many are known there. */
async function fetchPlaces(lat, lng, opts = {}) {
  const area = opts.box ? `(${opts.box.join(",")})` : `(around:${opts.radius || 2500},${lat},${lng})`;
  const data = await overpass(overpassQuery(area, opts.box ? 1500 : 700));
  const mult = opts.box ? 3 : 1, byCat = {};
  for (const el of data.elements || []) {
    const t = el.tags || {}, cat = classify(t);
    const la = el.lat ?? (el.center && el.center.lat), lo = el.lon ?? (el.center && el.center.lon);
    if (!cat || !isFinite(la) || !isFinite(lo)) continue;
    (byCat[cat] || (byCat[cat] = [])).push({ id: el.type[0] + el.id, n: t["name:en"] || t.name || CATS[cat].a.replace(/^A /, "") , c: cat, lat: +la.toFixed(6), lng: +lo.toFixed(6), d: C.dist(lat, lng, la, lo) });
  }
  let added = 0;
  const city = opts.city || cityLabelAt(lat, lng);
  for (const [cat, list] of Object.entries(byCat)) {
    list.sort((a, b) => a.d - b.d);
    for (const p of list.slice(0, CAT_CAP[cat] * mult)) {
      if (S.places[p.id]) continue;
      if (Object.values(S.places).some(o => o.c === p.c && o.n === p.n && C.dist(o.lat, o.lng, p.lat, p.lng) < 120)) continue;
      S.places[p.id] = { id: p.id, n: p.n, c: p.c, lat: p.lat, lng: p.lng, city };
      added++;
    }
  }
  S.pq.push([+lat.toFixed(4), +lng.toFixed(4), now()]); if (S.pq.length > 80) S.pq.shift();
  save();
  return added;
}
async function ensurePlaces(lat, lng) {
  if (placesBusy || now() - placesFailAt < 120000) return;
  if (S.pq.some(q => C.dist(q[0], q[1], lat, lng) < 1500 && now() - q[2] < 21 * 864e5)) return;
  placesBusy = true;
  try { const n = await fetchPlaces(lat, lng); if (n) { renderPlaces(); updateChrome(); pushNative(); } }
  catch (e) { placesFailAt = now(); }
  finally { placesBusy = false; }
}
function placeCheck(p) {
  for (const pl of Object.values(S.places)) {
    if (pl.found || Math.abs(pl.lat - p.lat) > 0.003) continue;
    const d = C.dist(p.lat, p.lng, pl.lat, pl.lng);
    if (d <= FOUND_R) { pl.found = p.t; pl.city = pl.city || cityLabelAt(pl.lat, pl.lng); foundQueue.push({ id: pl.id, d }); }
  }
}
function unfoundNear(lat, lng, m, max) {
  return Object.values(S.places).filter(p => !p.found).map(p => ({ p, d: C.dist(lat, lng, p.lat, p.lng) })).filter(x => x.d <= m).sort((a, b) => a.d - b.d).slice(0, max || 60);
}
/** "? places near today's walk": unfound places within 1.5 km of today's track, nearest to you first. */
function hintPlaces() {
  const me = S.last; if (!me) return [];
  const pts = S.track.d === dayKey() ? S.track.pts : [];
  const sample = pts.filter((_, i) => i % 4 === 0).concat([[me.lat, me.lng]]);
  const out = [];
  for (const p of Object.values(S.places)) {
    if (p.found) continue;
    if (sample.some(s => Math.abs(s[0] - p.lat) < 0.02 && C.dist(s[0], s[1], p.lat, p.lng) <= 1500)) out.push({ p, d: C.dist(me.lat, me.lng, p.lat, p.lng) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 5);
}

/* ---------- cities: Nominatim, politely (one request at a time, cached) ---------- */
let geoChain = Promise.resolve(), geoLast = 0;
function nominatim(path) {
  const run = async () => {
    const wait = Math.max(0, geoLast + 1100 - now()); if (wait) await new Promise(r => setTimeout(r, wait));
    geoLast = now();
    const r = await fetch(NOMINATIM + path + (path.includes("?") ? "&" : "?") + "format=jsonv2&accept-language=en");
    if (!r.ok) throw new Error("Nominatim " + r.status);
    return r.json();
  };
  const p = geoChain.then(run, run); geoChain = p.catch(() => {}); return p;
}
function cityFrom(res, lat, lng) {
  const a = res.address || {};
  const name = a.city || a.town || a.village || a.municipality || a.county || a.state_district || a.state || res.name || "Somewhere";
  const bb = (res.boundingbox || []).map(Number);
  const clat = +res.lat || lat, clng = +res.lon || lng;
  const box = C.clampBox(bb.length === 4 ? [bb[0], bb[2], bb[1], bb[3]] : null, clat, clng, CITY_KM);
  return { name, country: a.country || "", cc: (a.country_code || "").toLowerCase(), lat: clat, lng: clng, box };
}
async function geocodeCity(lat, lng) {
  const key = lat.toFixed(2) + "," + lng.toFixed(2);
  if (S.geo[key]) return S.geo[key];
  try {
    const res = await nominatim(`/reverse?lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`);
    const c = cityFrom(res, lat, lng); S.geo[key] = c;
    const ks = Object.keys(S.geo); if (ks.length > 60) delete S.geo[ks[0]];
    save(); return c;
  } catch (e) { return null; }
}
async function searchCities(q) {
  const res = await nominatim(`/search?q=${encodeURIComponent(q)}&limit=5&addressdetails=1`);
  return (res || []).map(r => Object.assign(cityFrom(r, +r.lat, +r.lon), { label: r.display_name }));
}
function cityLabelAt(lat, lng) {
  const t = activeTrip(); if (t && t.box && C.inBox(t.box, lat, lng)) return t.city;
  if (S.homeCity && C.inBox(S.homeCity.box, lat, lng)) return S.homeCity.name;
  if (t) return t.city;
  const known = Object.values(S.geo).find(g => g.box && C.inBox(g.box, lat, lng));
  return known ? known.name : (S.homeCity ? S.homeCity.name : "");
}
/** The city the HUD shows: the trip's city on a trip, otherwise home. */
function ctxCity() {
  const t = activeTrip(); if (t) return { name: t.city, box: t.box || C.clampBox(null, t.lat, t.lng, CITY_KM), trip: t };
  if (S.homeCity && S.homeCity.box) return { name: S.homeCity.name, box: S.homeCity.box };
  return null;
}

/* ---------- trips ---------- */
const activeTrip = () => S.tripId ? S.trips.find(t => t.id === S.tripId) || null : null;
const tripById = id => S.trips.find(t => t.id === id) || null;
const tripDayNo = (t, d) => Math.round((dayDate(d) - dayDate(dayKey(t.start))) / 864e5) + 1;
function tripDays(t) { const out = []; const end = t.end || now(); for (let d = dayDate(dayKey(t.start)); d <= new Date(end); d.setDate(d.getDate() + 1)) out.push(dayKey(d.getTime())); return out; }
function tripCheck(p) {
  const home = homePoint(); if (!home) return;
  const d = C.dist(p.lat, p.lng, home.lat, home.lng) / 1000;
  const t = activeTrip();
  if (!t && d > TRIP_KM) startTrip(p);
  else if (t && d < HOME_BACK_KM) endTrip(p.t);
}
function startTrip(p) {
  const pre = Object.values(S.offline).find(o => C.dist(o.lat, o.lng, p.lat, p.lng) < 30000);
  const t = { id: uid(), start: p.t, end: 0, lat: p.lat, lng: p.lng, city: pre ? pre.name : "New city", country: pre ? pre.country : "", cc: pre ? pre.cc : "", box: pre ? pre.box : null,
    stars: {}, hl: [], welcomed: false, recapSeen: {}, doneSeen: false };
  S.trips.unshift(t); S.tripId = t.id; TS.set(t.id, { all: new Set(), days: {} });
  if (!pre) geocodeCity(p.lat, p.lng).then(c => { if (c) { Object.assign(t, { city: c.name, country: c.country, cc: c.cc, box: c.box }); for (const pl of Object.values(S.places)) if (pl.city === "New city") pl.city = c.name; save(); updateChrome(); maybeWelcome(); } });
  save();
  setTimeout(maybeWelcome, 50);
}
function endTrip(t) {
  const trip = activeTrip(); if (!trip) return;
  trip.end = t || now(); S.tripId = null; save();
  setTimeout(() => { if (typeof onTripEnded === "function") onTripEnded(trip); }, 50);
}
function tripStats(t) {
  const days = tripDays(t); let w = 0, got = 0;
  for (const d of days) { const l = S.days[d]; if (l) { w += l.w; } }
  got = Object.values(S.places).filter(p => p.got && p.got >= t.start && (!t.end || p.got <= t.end + 60000)).length;
  const ts = TS.get(t.id), pct = t.box && ts ? boxStatsRaw(t.box, ts.all).p : 0;
  return { days: days.length, km: w, got, pct, cells: ts ? ts.all.size : 0 };
}
const tripPhotos = t => Object.entries(S.photos).filter(([, m]) => m.t >= t.start && (!t.end || m.t <= t.end + 60000)).sort((a, b) => a[1].t - b[1].t).map(([id]) => id);
function tripCover(t) { const ph = tripPhotos(t); const st = Object.values(t.stars || {})[0]; return st || ph[0] || null; }

/* ---------- native bridge (Android) ---------- */
let NST = {}, pushedCells = 0, permWaiters = [];
const nCall = (fn, ...a) => { try { return N && N[fn] ? N[fn](...a) : undefined; } catch (e) { return undefined; } };
function nativePerms() { try { return JSON.parse(nCall("permissions") || "{}"); } catch (e) { return {}; } }
function askNative(kind) {
  return new Promise(res => {
    let done = false; const fin = () => { if (!done) { done = true; res(nativePerms()); } };
    permWaiters.push(fin); setTimeout(fin, 90000);
    if (nCall("requestPermission", kind) === false) fin();
  });
}
window.wanderOnPermission = () => { permWaiters.splice(0).forEach(f => f()); if (typeof updateChrome === "function") updateChrome(); };
function pollNative() {
  if (!N) return;
  let pts = [];
  try { pts = JSON.parse(nCall("takePoints") || "[]"); } catch (e) { pts = []; }
  if (pts.length) ingest(pts.map(a => ({ t: a[0], lat: a[1], lng: a[2], acc: a[3], spd: a[4] >= 0 ? a[4] : null })));
  try { NST = JSON.parse(nCall("status") || "{}"); } catch (e) { NST = {}; }
  if (NST.pausedUntil != null && NST.pausedUntil !== S.paused) { S.paused = NST.pausedUntil; save(); }
  if (NST.last && (!S.last || NST.last.t > S.last.t)) {
    // the service doesn't record inside quiet places, so its latest fix is how the page learns you're home (and a trip is over)
    S.last = NST.last; tripCheck(NST.last);
    inQuietNow = S.tracking === "smart" ? quietAt(NST.last.lat, NST.last.lng) : null;
  }
  updateChrome();
}
function knownNear(lat, lng, m, cap) {
  const out = [], x0 = C.mx(lng), y0 = C.my(lat), rm = m / Math.cos(lat * Math.PI / 180);
  for (const set of [WALK, DRIVE]) for (const k of set) { const c = C.cellXY(k); if (Math.abs(c[0] - x0) < rm && Math.abs(c[1] - y0) < rm) { out.push(k); if (out.length >= cap) return out; } }
  return out;
}
function pushNative() {
  if (!N) return;
  nCall("setQuietPlaces", JSON.stringify(S.quiet.filter(q => q.on !== false).map(q => ({ name: q.name, lat: q.lat, lng: q.lng, r: q.r }))));
  const me = S.last;
  if (me) {
    nCall("setNearbyPlaces", JSON.stringify(unfoundNear(me.lat, me.lng, 3000, 60).map(x => ({ id: x.p.id, name: x.p.n, cat: CATS[x.p.c].one, lat: x.p.lat, lng: x.p.lng }))));
    if (pushedCells !== cellsVersion) { nCall("setKnownCells", JSON.stringify(knownNear(me.lat, me.lng, 30000, 40000))); pushedCells = cellsVersion; }
  }
  const t = activeTrip(), td = S.days[dayKey()] || { got: [] };
  nCall("setStatus", JSON.stringify({ streak: streak(), today: dayKey(), todayNew: todayNew(), todayPlaces: (td.got || []).length, notif: S.notif, tracking: S.tracking,
    home: homePoint(), trip: t ? { id: t.id, city: t.city, day: tripDayNo(t, dayKey()) } : null }));
}

/* ---------- browser fallback: track while the page is open ---------- */
let watchId = null;
function startWebTracking() {
  if (N || watchId != null || !navigator.geolocation || !S.firstFix) return;
  watchId = navigator.geolocation.watchPosition(onWebFix, onGeoError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
}
function stopWebTracking() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
function onWebFix(pos) { ingest([{ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, spd: pos.coords.speed, t: Date.now() }]); }
let geoErr = null;
function onGeoError(e) { geoErr = e; updateChrome(); }

/* ---------- map ---------- */
let map, fog, tileLayer, meMarker, placeLayer, pathLayer, quietLayer, guideLine, FRIEND = null;
const TILE_CACHE = "wander-tiles";
async function tileBlob(url, network = true) {
  if (window.caches) {
    try { const c = await caches.open(TILE_CACHE); const hit = await c.match(url); if (hit) return await hit.blob(); } catch (e) { /* no cache */ }
  }
  if (!network) throw new Error("not cached");
  const r = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!r.ok) throw new Error("tile " + r.status);
  if (window.caches) { try { const c = await caches.open(TILE_CACHE); await c.put(url, r.clone()); if (++tilePuts % 150 === 0) pruneTiles(c); } catch (e) { /* full */ } }
  return r.blob();
}
let tilePuts = 0;
/** Keeps the tile cache to about 3,000 tiles (~50 MB), dropping the oldest first (cache keys keep insertion order). */
async function pruneTiles(c) {
  try { const ks = await c.keys(); for (const k of ks.slice(0, Math.max(0, ks.length - 3000))) await c.delete(k); } catch (e) { /* ignore */ }
}
const CachedTiles = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement("img"), url = this.getTileUrl(coords);
    img.alt = ""; img.setAttribute("role", "presentation");
    const plain = () => { img.onload = () => done(null, img); img.onerror = e => done(e, img); img.src = url; };
    tileBlob(url).then(b => { const u = URL.createObjectURL(b); img.onload = () => { URL.revokeObjectURL(u); done(null, img); }; img.onerror = () => { URL.revokeObjectURL(u); plain(); }; img.src = u; }).catch(plain);
    return img;
  }
});
let THEME = null;
function themeColors() {
  if (THEME) return THEME;
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  const name = S.theme;
  THEME = { night: name === "night", fog: v("--fog") || "#c9ccd4", fogA: name === "night" ? 0.86 : 0.93, driveCut: name === "night" ? 0.45 : 0.55, accent: v("--accent"), friend: v("--friend"), land: v("--land"),
    bg: v("--bg"), ink: v("--ink"), muted: v("--muted"), card: v("--card"), chip: v("--chip"), tiles: v("--tiles") };
  return THEME;
}
const HX = [], HY = [];
for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); HX.push(Math.cos(a)); HY.push(Math.sin(a)); }
/** Keys of a set inside a Mercator box (padded), by whichever is cheaper: scanning the set or the box. */
function visibleCells(set, x1, y1, x2, y2) {
  const pad = C.HEX * 2; x1 -= pad; y1 -= pad; x2 += pad; y2 += pad;
  if (set.size > 3000) {
    const box = C.cellsInBox(x1, y1, x2, y2, set.size);
    if (box) return box.filter(k => set.has(k));
  }
  const out = [];
  for (const k of set) { const c = C.cellXY(k); if (c[0] >= x1 && c[0] <= x2 && c[1] >= y1 && c[1] <= y2) out.push(k); }
  return out;
}
function hexPath(ctx, keys, k, ox, oy, s) {
  ctx.beginPath();
  if (s < 1.6) { for (const key of keys) { const c = C.cellXY(key); ctx.rect((c[0] + C.PI_R) * k - ox - 1, (C.PI_R - c[1]) * k - oy - 1, 2, 2); } return; }
  for (const key of keys) {
    const c = C.cellXY(key), cx = (c[0] + C.PI_R) * k - ox, cy = (C.PI_R - c[1]) * k - oy;
    ctx.moveTo(cx + HX[0] * s, cy + HY[0] * s);
    for (let i = 1; i < 6; i++) ctx.lineTo(cx + HX[i] * s, cy + HY[i] * s);
    ctx.closePath();
  }
}
/** Paints fog with hex holes onto ctx for the Mercator window starting at world pixel (ox, oy), size w x h, k px per Mercator metre. */
function paintFog(ctx, w, h, k, ox, oy, o = {}) {
  const th = themeColors(), s = C.HEX * k;
  const x1 = ox / k - C.PI_R, x2 = (ox + w) / k - C.PI_R, y2 = C.PI_R - oy / k, y1 = C.PI_R - (oy + h) / k;
  ctx.save();
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = o.fogA || th.fogA; ctx.fillStyle = o.fog || th.fog; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  if (s > 5) ctx.filter = "blur(" + Math.min(3, s / 12).toFixed(1) + "px)";
  const filt = o.hideQuiet ? (keys => keys.filter(key => { const ll = C.cellLatLng(key); return !nearQuiet(ll[0], ll[1], 60); })) : (x => x);
  const walked = filt(visibleCells(o.walk || WALK, x1, y1, x2, y2));
  hexPath(ctx, walked, k, ox, oy, s * 1.06); ctx.fill();
  if (th.night && s > 4) { // Night explorer: faint glowing cell edges over what you've uncovered
    ctx.filter = "none"; ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.22; ctx.strokeStyle = th.accent; ctx.lineWidth = 1;
    hexPath(ctx, walked, k, ox, oy, s * 0.97); ctx.stroke(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "destination-out"; if (s > 5) ctx.filter = "blur(" + Math.min(3, s / 12).toFixed(1) + "px)";
  }
  const dr = o.drive === undefined ? DRIVE : o.drive;
  if (dr && dr.size) { ctx.globalAlpha = th.driveCut; hexPath(ctx, filt(visibleCells(dr, x1, y1, x2, y2)), k, ox, oy, s * 1.06); ctx.fill(); }
  ctx.filter = "none"; ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  const fr = o.friend === undefined ? FRIEND && FRIEND.cells : o.friend;
  if (fr && fr.size) {
    hexPath(ctx, visibleCells(fr, x1, y1, x2, y2), k, ox, oy, s * 0.96);
    ctx.fillStyle = th.friend; ctx.globalAlpha = 0.2; ctx.fill(); ctx.globalAlpha = s > 4 ? 0.45 : 0; ctx.strokeStyle = th.friend; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.restore();
}
const FogLayer = L.Renderer.extend({
  _initContainer() { this._container = L.DomUtil.create("canvas", "fog-canvas"); this._ctx = this._container.getContext("2d"); },
  _destroyContainer() { L.DomUtil.remove(this._container); },
  _update() {
    if (this._map._animatingZoom && this._bounds) return;
    L.Renderer.prototype._update.call(this);
    const b = this._bounds, size = b.getSize(), c = this._container, dpr = Math.min(window.devicePixelRatio || 1, 2);
    L.DomUtil.setPosition(c, b.min);
    c.width = Math.round(size.x * dpr); c.height = Math.round(size.y * dpr);
    c.style.width = size.x + "px"; c.style.height = size.y + "px";
    this._dpr = dpr; this.draw();
  },
  draw() {
    const m = this._map; if (!m || !this._bounds) return;
    const ctx = this._ctx, b = this._bounds, size = b.getSize(), o = m.getPixelOrigin();
    const k = 256 * Math.pow(2, m.getZoom()) / (2 * C.PI_R);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this._container.width, this._container.height);
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    paintFog(ctx, size.x, size.y, k, o.x + b.min.x, o.y + b.min.y);
    this.drawnVersion = cellsVersion;
  }
});
const pinIcon = (cls, html) => L.divIcon({ className: "pin " + cls, html: html || "<b></b>", iconSize: [30, 30], iconAnchor: [15, 15] });
function initMap() {
  map = L.map("map", { zoomControl: false, minZoom: 3, maxZoom: 19, zoomSnap: 0.5, worldCopyJump: false, attributionControl: true });
  map.attributionControl.setPrefix(false);
  tileLayer = new CachedTiles(TILE_URL, { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
  map.createPane("fog"); map.getPane("fog").style.zIndex = 350; map.getPane("fog").style.pointerEvents = "none";
  fog = new FogLayer({ pane: "fog", padding: 0.35 }); map.addLayer(fog);
  quietLayer = L.layerGroup().addTo(map); pathLayer = L.layerGroup().addTo(map); placeLayer = L.layerGroup().addTo(map);
  const start = S.last || S.home;
  if (start) map.setView([start.lat, start.lng], 16); else map.setView([20, 10], 3);
  map.on("moveend", () => { renderPlaces(); });
  map.on("dragstart", () => { follow = false; });
}
let follow = true;
function redrawFog() { if (fog && fog._map) fog.draw(); }
function renderMe() {
  const me = S.last; if (!map || !me) return;
  if (!meMarker) meMarker = L.marker([me.lat, me.lng], { icon: pinIcon("pin-me"), interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(map);
  else meMarker.setLatLng([me.lat, me.lng]);
}
function renderPath() {
  if (!pathLayer) return; pathLayer.clearLayers();
  if (S.track.d !== dayKey() || S.track.pts.length < 2) return;
  const th = themeColors(); let run = [], mode = null;
  const flush = () => { if (run.length > 1) L.polyline(run, mode ? { color: th.accent, weight: 3, opacity: 0.85, interactive: false } : { color: "#9ca3af", weight: 2, dashArray: "5 4", opacity: 0.9, interactive: false }).addTo(pathLayer); };
  for (const p of S.track.pts) { if (p[2] !== mode && run.length) { const l = run[run.length - 1]; flush(); run = [l]; } mode = p[2]; run.push([p[0], p[1]]); }
  flush();
}
function renderQuiet() {
  if (!quietLayer) return; quietLayer.clearLayers();
  for (const q of S.quiet) {
    if (q.on === false) continue;
    L.circle([q.lat, q.lng], { radius: q.r, color: "#6b7280", weight: 1.5, dashArray: "5 4", fillColor: "#9ca3af", fillOpacity: 0.2, interactive: false }).addTo(quietLayer);
    L.marker([q.lat, q.lng], { icon: L.divIcon({ className: "pin-quiet", html: esc(q.name) + " · quiet", iconSize: [140, 16], iconAnchor: [70, -8] }), interactive: false, keyboard: false }).addTo(quietLayer);
  }
}
function renderPlaces() {
  if (!map || !placeLayer) return;
  placeLayer.clearLayers();
  if (map.getZoom() < 13) return;
  const b = map.getBounds().pad(0.2); let n = 0;
  for (const p of Object.values(S.places)) {
    if (!b.contains([p.lat, p.lng]) || n++ > 300) continue;
    const cls = p.got ? "pin-got" : p.found ? "pin-new" : "pin-q";
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(cls, p.found || p.got ? "<b></b>" : "<b>?</b>"), title: p.found || p.got ? p.n : CATS[p.c].a, alt: p.found || p.got ? p.n : "Unknown place", zIndexOffset: p.found && !p.got ? 500 : 0 });
    m.on("click", () => openPlace(p.id));
    m.addTo(placeLayer);
  }
}
function renderGuide() {
  if (guideLine) { guideLine.remove(); guideLine = null; }
  const p = GUIDE && S.places[GUIDE], me = S.last;
  if (!p || !me || !map) return;
  guideLine = L.polyline([[me.lat, me.lng], [p.lat, p.lng]], { color: "#2563eb", weight: 3, dashArray: "7 7", interactive: false }).addTo(map);
}
let GUIDE = null;
