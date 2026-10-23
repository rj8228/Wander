/* Wander screens: onboarding, map chrome, places and capture, collection, trips, me, settings, sharing. Boots the app at the end. */
"use strict";

/* ---------- layers: sheets and full pages stacked over the app ---------- */
const LAYERS = document.getElementById("layers");
function openLayer(html, o = {}) {
  const w = document.createElement("div"); w.className = "layer"; if (o.id) w.dataset.id = o.id;
  w.innerHTML = (o.scrim ? '<div class="scrim" data-a="close"></div>' : "") + html;
  w._onClose = o.onClose; LAYERS.appendChild(w); return w;
}
const sheet = (inner, o = {}) => openLayer(`<div class="sheet${o.nav ? " above-nav" : ""}"${o.label ? ` aria-label="${esc(o.label)}"` : ""}><div class="in"><div class="grab"></div>${inner}</div></div>`, Object.assign({ scrim: !o.nav }, o));
const page = (inner, o = {}) => openLayer(`<div class="pg"><div class="inner">${inner}</div></div>`, o);
function closeLayer(l) { if (!l || !l.parentNode) return; l.remove(); if (l._onClose) l._onClose(); }
function closeTop() { const l = LAYERS.lastElementChild; if (!l) return false; closeLayer(l); return true; }
function closeAll() { while (LAYERS.lastElementChild) closeLayer(LAYERS.lastElementChild); }
const closeById = id => $$(`.layer[data-id="${id}"]`, LAYERS).forEach(closeLayer);
const layerOpen = id => !!$(`.layer[data-id="${id}"]`, LAYERS);
const back = (label = "Back") => `<button class="back" type="button" data-a="close">‹ ${esc(label)}</button>`;
window.wanderBack = () => { if (closeTop()) return "closed"; if (FRIEND) { endCompare(); return "closed"; } if (GUIDE) { endGuide(); return "closed"; } if (TAB !== "map") { showTab("map"); return "closed"; } return "none"; };

let toastTimer = 0;
function toast(html, o = {}) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.hidden = false; t.innerHTML = html + (o.action ? ` <button type="button" id="toast-act">${esc(o.action)}</button>` : "");
  t.onclick = e => { if (e.target.id === "toast-act" && o.fn) o.fn(); t.hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, o.ms || 5000);
}

/* ---------- tabs ---------- */
let TAB = "map";
function showTab(name) {
  TAB = name;
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + name));
  $$("#nav button").forEach(b => { b.classList.toggle("on", b.dataset.tab === name); if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (name === "map") { setTimeout(() => { map.invalidateSize(); redrawFog(); }, 0); updateChrome(); }
  if (name === "collection") renderCollection();
  if (name === "trips") renderTrips();
  if (name === "me") renderMeTab();
}

/* ---------- theme ---------- */
const THEMES = [["day", "Daylight", "#f4f5f7", "#ff5a1f"], ["night", "Night explorer", "#1d2433", "#4ff0c8"], ["atlas", "Explorer's atlas", "#efe4cc", "#a8432a"]];
function applyTheme() {
  if (S.theme === "day") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme;
  THEME = null;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = themeColors().bg || "#f4f5f7";
  nCall("setTheme", S.theme === "night");
  if (map) { redrawFog(); renderPath(); }
}

/* ---------- intro art: a little fog map drawn as SVG ---------- */
function artSVG(kind) {
  const W = 390, H = 320, s = 12, SQ = Math.sqrt(3), id = "art" + kind + Math.random().toString(36).slice(2, 6);
  const path = [[30, 300], [70, 262], [110, 236], [140, 204], [160, 172], [196, 150], [236, 140], [262, 112], [292, 84], [338, 60], [372, 40]];
  const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
  let holes = "";
  for (let r = -1; r < H / (s * 1.5) + 2; r++) for (let q = -Math.ceil(r / 2) - 2; q < W / (s * SQ) + 2; q++) {
    const x = s * SQ * (q + r / 2), y = s * 1.5 * r;
    const d = kind === 0 ? Math.hypot(x - 195, y - 165) : Math.min(...path.slice(1).map((b, i) => segD(x, y, path[i], b)));
    if (d < (kind === 0 ? 40 : 21)) holes += `<polygon points="${Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return (x + s * 1.05 * Math.cos(a)).toFixed(1) + "," + (y + s * 1.05 * Math.sin(a)).toFixed(1); }).join(" ")}"/>`;
  }
  let streets = "";
  for (let i = -2; i < 18; i++) streets += `<line x1="${i * 26}" y1="-10" x2="${i * 26 + 70}" y2="${H + 10}" stroke="#dde0e6" stroke-width="2"/>`;
  for (let j = -2; j < 18; j++) streets += `<line x1="-10" y1="${j * 24}" x2="${W + 10}" y2="${j * 24 - 36}" stroke="#dde0e6" stroke-width="2"/>`;
  const pins = kind === 1 ? `<circle cx="160" cy="172" r="8" fill="#ff5a1f" stroke="#fff" stroke-width="3"/><circle cx="262" cy="112" r="8" fill="#ff5a1f" stroke="#fff" stroke-width="3"/><g transform="translate(90 120)"><circle r="12" fill="none" stroke="#8a8f9c" stroke-dasharray="3 3" stroke-width="1.6"/><text y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#7b808c">?</text></g><g transform="translate(300 200)"><circle r="12" fill="none" stroke="#8a8f9c" stroke-dasharray="3 3" stroke-width="1.6"/><text y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#7b808c">?</text></g>`
    : kind === 2 ? `<path d="M196 150 L236 140" stroke="#ff5a1f" stroke-width="3"/><g transform="translate(236 140)"><circle r="20" fill="#ff5a1f" fill-opacity=".2"/><circle r="10" fill="#ff5a1f" stroke="#fff" stroke-width="3"/></g>`
    : `<g transform="translate(195 165)"><circle r="18" fill="#2563eb" fill-opacity=".15"/><circle r="7" fill="#2563eb" stroke="#fff" stroke-width="2.5"/></g>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="white"/><g fill="black">${holes}</g></mask><filter id="${id}b"><feGaussianBlur stdDeviation="2"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#f4f5f7"/><path d="M-20 290 C 60 270, 130 330, 210 300 S 330 260, 420 280 L 420 340 L -20 340 Z" fill="#b9dcf2"/><path d="M200 200 q34 -18 58 2 q10 32 -16 52 q-34 8 -48 -16 z" fill="#cdebd3"/>${streets}
    <path d="M-10 250 C 70 220, 140 200, 196 150 S 300 90, 400 40" stroke="#fff" stroke-width="7" fill="none"/>
    ${kind === 1 ? `<polyline points="${path.map(p => p.join(",")).join(" ")}" fill="none" stroke="#ff5a1f" stroke-width="3" stroke-linejoin="round" opacity=".85"/>` : ""}
    <g filter="url(#${id}b)"><rect width="${W}" height="${H}" fill="#c9ccd4" fill-opacity=".95" mask="url(#${id}m)"/></g>${pins}</svg>`;
}

/* ---------- first run ---------- */
const SLIDES = [
  ["The world is dark.<br>Walk to light it up.", "Every street you walk uncovers the map. Find places, take photos, collect them."],
  ["Find places.<br>Collect them.", "Viewpoints, cafés and parks hide in the fog as ?. Walk close, take guided photos, and they're yours."],
  ["Trips turn into<br>memories.", "A new city starts a trip by itself, with a recap each evening and a memory lane when you're home."]
];
function showIntro(i = 0) {
  closeById("onb");
  const l = openLayer(`<div class="onb" data-slide="${i}"><div class="art">${artSVG(i)}</div><div class="h1">${SLIDES[i][0]}</div><p>${SLIDES[i][1]}</p>
    <div class="dots">${SLIDES.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:16px">${i < 2 ? `<button class="btn g" style="flex:1;margin:0" type="button" data-a="intro-next">Next</button>` : ""}<button class="btn" style="flex:2;margin:0" type="button" data-a="intro-go">Get started</button></div>
    ${i === 0 ? `<label class="back" style="align-self:center;margin-top:8px;cursor:pointer">New phone? Restore a backup<input type="file" accept=".json,application/json" hidden data-file="restore"></label>` : ""}</div>`, { id: "onb" });
  let x0 = null; const el = $(".onb", l);
  el.addEventListener("pointerdown", e => { x0 = e.clientX; });
  el.addEventListener("pointerup", e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) { const n = i + (dx < 0 ? 1 : -1); if (n >= 0 && n < 3) showIntro(n); } });
}
function showWhyLocation() {
  closeById("onb");
  openLayer(`<div class="onb"><div class="bigicon" aria-hidden="true">📍</div><div class="h1">Wander needs your location</div>
    <p>To lift the fog where you are. Your location never leaves this phone unless you share a card.</p><div style="flex:1"></div>
    <button class="btn" type="button" data-a="loc-continue">Continue</button></div>`, { id: "onb" });
}
async function requestLocation() {
  if (N) {
    let p = nativePerms();
    if (!p.fine && !p.coarse) p = await askNative("location");
    if (!p.fine && !p.coarse) return locationDenied();
    closeById("onb");
    nCall("startTracking", S.tracking);
    if (p.sdk >= 33 && !p.notify) askNative("notifications");
    toast("Finding you… step outside if it takes a while.", { ms: 8000 });
    pollNative();
  } else {
    if (!navigator.geolocation) return locationDenied(true);
    navigator.geolocation.getCurrentPosition(pos => { closeById("onb"); onWebFix(pos); startWebTracking(); }, () => locationDenied(), { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }
}
function locationDenied(unsupported) {
  closeById("onb"); closeById("denied");
  sheet(`<div class="tag">Location is off</div><div class="t1">Wander can't lift the fog without it</div>
    <div class="t2">${unsupported ? "This browser can't share your location." : N ? "Allow location for Wander, then come back." : "Allow location for this site in your browser settings, then try again."}</div>
    <button class="btn" type="button" data-a="loc-retry">Try again</button>${N ? `<button class="btn g" type="button" data-a="open-settings">Open app settings</button>` : ""}<button class="btn g" type="button" data-a="close">Look around first</button>`, { id: "denied", nav: true });
}
function showAfterFirstWalk() {
  S.askedBg = true; save();
  const n = WALK.size + DRIVE.size;
  sheet(`<div class="tag">Nice first walk · ${n} cells</div><div class="t1">Keep it going with the screen off?</div><div class="t2">Lets walks count while the phone is in your pocket.</div>
    <button class="btn" type="button" data-a="bg-allow">Allow background location</button><button class="btn g" type="button" data-a="bg-later">Not now</button>`, { id: "firstwalk", nav: true });
}
function showWhyBackground() {
  closeById("firstwalk");
  if (N) {
    openLayer(`<div class="onb"><div class="bigicon" aria-hidden="true">🌙</div><div class="h1">Keep uncovering with the screen off</div>
      <p>Choose <b>Allow all the time</b> on the next screen. Walks then count even when the phone is in your pocket. A notification always shows while it's recording, and you can pause it any time.</p><div style="flex:1"></div>
      <button class="btn" type="button" data-a="bg-settings">Open settings</button><button class="btn g" type="button" data-a="bg-skip">Not now</button></div>`, { id: "onb" });
  } else {
    openLayer(`<div class="onb"><div class="bigicon" aria-hidden="true">🌙</div><div class="h1">Keep uncovering with the screen off</div>
      <p>In a browser, Wander can only uncover the map while this page is open. The Android app keeps going with the screen off, with a notification while it records.</p><div style="flex:1"></div>
      <a class="btn" href="${APK_URL}" target="_blank" rel="noopener">Get the Android app</a><button class="btn g" type="button" data-a="bg-skip">Continue in the browser</button></div>`, { id: "onb" });
  }
}
let QDRAFT = null;
function showQuietSetup() {
  closeById("onb"); closeById("firstwalk"); closeById("quiet");
  const h = S.home || S.last;
  if (!QDRAFT) QDRAFT = S.quiet.length ? S.quiet.map(q => Object.assign({}, q)) : (h ? [{ id: uid(), name: "Home", lat: h.lat, lng: h.lng, r: 250, on: true, hint: "Where your phone is at night" }] : []);
  sheet(`<div class="tag">Smart tracking</div><div class="t1">Where should tracking stay off?</div>
    <div class="t2">Inside quiet places GPS is off. It turns on when you leave, and stays on for trips. Quiet places are hidden on anything you share.</div>
    ${QDRAFT.map((q, i) => `<div class="row"><div><b>${esc(q.name)}</b><div class="t2">${esc(q.hint || "Quiet place")} · ${q.r} m</div></div><button type="button" class="sw${q.on !== false ? " on" : ""}" role="switch" aria-checked="${q.on !== false}" aria-label="${esc(q.name)}" data-a="qd-toggle" data-i="${i}"></button></div>`).join("")}
    <button class="row" type="button" data-a="qd-add"><b style="color:var(--accent-ink)">＋ Add a quiet place</b><span class="r">at the map centre</span></button>
    <button class="btn" type="button" data-a="qd-save">Save quiet places</button>`, { id: "quiet", label: "Quiet places" });
}
function saveQuiet(list) {
  S.quiet = list.map(q => ({ id: q.id || uid(), name: q.name, lat: q.lat, lng: q.lng, r: q.r, on: q.on !== false }));
  S.quietAsked = true; save(); renderQuiet(); pushNative(); bsCache.v = 0; updateChrome();
}
function checkHomeSuggest() {
  if (!S.firstFix || !S.last || S.quiet.some(q => /home/i.test(q.name)) || now() - S.homeAsk < 3 * 864e5 || LAYERS.children.length) return;
  const n = Object.values(S.nights).filter(p => C.dist(p[0], p[1], S.last.lat, S.last.lng) < 200).length;
  if (n < 2) return;
  S.homeAsk = now(); save();
  sheet(`<div class="tag">Looks like home</div><div class="t1">Make this a private area?</div><div class="t2">You spent the last ${n} nights here. It still counts for you, but it's blurred on anything you share.</div>
    <button class="btn" type="button" data-a="home-set">Set as home · 400 m</button><button class="btn g" type="button" data-a="close">Not home</button>`, { id: "homeask", nav: true });
}

/* ---------- map chrome: HUD, pill, chips ---------- */
let lastTrackLen = -1, lastPush = 0;
function updateChrome() {
  if (!map) return;
  if (fog && fog.drawnVersion !== cellsVersion) redrawFog();
  renderMe();
  const tl = S.track.pts.length + (S.track.d === dayKey() ? 0 : 1e6);
  if (tl !== lastTrackLen) { lastTrackLen = tl; renderPath(); }
  renderHud(); renderPill(); renderChip();
  const nd = $('#nav [data-tab="trips"]'); const tripDot = S.trips.some(t => t.end && !t.doneSeen);
  if (nd) { let d = $(".dot", nd); if (tripDot && !d) nd.insertAdjacentHTML("beforeend", '<i class="dot"></i>'); if (!tripDot && d) d.remove(); }
}
function renderHud() {
  const hud = $("#hud");
  if (FRIEND) {
    const b = FRIEND.meta.b, mine = boxStatsRaw(b, WALK, DRIVE), them = FRIEND.meta.p != null ? FRIEND.meta.p : 100 * FRIEND.cells.size / C.boxCells(b);
    let onlyMe = 0, onlyThem = 0; const x1 = C.mx(b[1]), x2 = C.mx(b[3]), y1 = C.my(b[0]), y2 = C.my(b[2]);
    const inb = k => { const c = C.cellXY(k); return c[0] >= x1 && c[0] <= x2 && c[1] >= y1 && c[1] <= y2; };
    for (const s of [WALK, DRIVE]) for (const k of s) if (inb(k) && !FRIEND.cells.has(k)) onlyMe++;
    for (const k of FRIEND.cells) if (!WALK.has(k) && !DRIVE.has(k)) onlyThem++;
    const nm = esc(FRIEND.meta.n || "Friend");
    hud.innerHTML = `<button class="x" type="button" data-a="compare-end" aria-label="Close compare">✕</button><div class="r1" style="padding-right:34px"><span class="city">${esc(FRIEND.meta.c || "Compare")}</span><span class="muted small">Compare</span></div>
      <div class="vs"><b style="color:var(--accent-ink)" id="cmp-me">You ${C.fmtPct(mine.p)}</b><b style="color:var(--friend)" id="cmp-them">${nm} ${C.fmtPct(them)}</b></div>
      <div class="sub"><span id="cmp-onlyme">Only you: ${onlyMe.toLocaleString()} cells</span><span id="cmp-onlythem">Only ${nm}: ${onlyThem.toLocaleString()} cells</span></div>`;
    return;
  }
  if (GUIDE && S.places[GUIDE]) {
    const p = S.places[GUIDE], d = S.last ? C.dist(S.last.lat, S.last.lng, p.lat, p.lng) : null;
    hud.innerHTML = `<button class="x" type="button" data-a="guide-end" aria-label="Stop guiding">✕</button><div class="t2">Heading to</div><div class="city" style="font-size:19px;padding-right:34px">${p.found ? esc(p.n) : "? " + esc(CATS[p.c].a)}${d != null ? " · " + C.fmtDist(d) : ""}</div><div class="t2">${p.found ? "You found it. Tap the pin to collect it." : "The name shows when you're within 150 m"}</div>`;
    return;
  }
  const c = ctxCity(), st = c ? boxStats(c.box) : null, sk = streak(), t = activeTrip();
  const right = t ? "Trip day " + tripDayNo(t, dayKey()) : sk ? plural(sk, "-day streak", "-day streak").replace(" -", "-") : "";
  if (!S.firstFix) { hud.innerHTML = `<div class="r1"><span class="city">Wander</span><span class="pct">0%</span></div><div class="bar"><i style="width:0"></i></div><div class="sub"><span>Turn on location to start</span><span></span></div>`; return; }
  hud.innerHTML = `<div class="r1"><span class="city" id="hud-city">${esc(c ? c.name : "Your map")}</span><span class="pct" id="hud-pct">${st ? C.fmtPct(st.p) : (WALK.size + DRIVE.size).toLocaleString()}</span></div>
    <div class="bar"><i style="width:${st ? Math.min(100, Math.max(st.p, 1)) : 2}%"></i></div>
    <div class="sub"><span>${st ? (st.d ? `Walked ${C.fmtPct(st.pw)} · driven ${C.fmtPct(st.pd)}` : `${(st.w + st.d).toLocaleString()} of ${st.total.toLocaleString()} cells`) : (WALK.size + DRIVE.size) + " cells uncovered"}</span><span id="hud-streak">${esc(right)}</span></div>`;
}
function renderPill() {
  const pill = $("#pill"), sp = $("span", pill); let txt, off = false;
  const tn = todayNew();
  if (!S.firstFix && !S.last) { txt = "Location off · tap to start"; off = true; }
  else if (isPaused()) { txt = pausedLabel(); off = true; }
  else if (N && NST.perms && !NST.perms.fine && !NST.perms.coarse) { txt = "Location off · tap to fix"; off = true; }
  else if (!N && geoErr && geoErr.code === 1) { txt = "Location blocked in this browser"; off = true; }
  else if (inQuietNow && S.tracking !== "always") { txt = `${inQuietNow.name} · quiet, GPS off`; off = true; }
  else if (N && NST.mode === "still") txt = "Resting · resumes when you move";
  else txt = (N ? "Tracking" : "Tracking while open") + " · " + plural(tn, "new cell") + " today";
  sp.textContent = txt; pill.classList.toggle("off", off);
}
function renderChip() {
  const chip = $("#chip"), legend = $("#legend");
  const t = activeTrip(), dk = dayKey(), h = new Date().getHours() + new Date().getMinutes() / 60;
  if (FRIEND) { chip.hidden = false; chip.textContent = "Send yours back ›"; chip.dataset.mode = "sendback"; }
  else if (GUIDE) { chip.hidden = false; chip.textContent = "Open in Google Maps"; chip.dataset.mode = "gmaps"; }
  else if (t && h >= 20.5 && !(t.recapSeen || {})[dk]) { chip.hidden = false; chip.textContent = `Day ${tripDayNo(t, dk)} in ${t.city}: your recap ›`; chip.dataset.mode = "recap"; }
  else {
    const hp = S.last ? hintPlaces() : [];
    chip.hidden = !hp.length; chip.textContent = `${hp.length} ? ${hp.length === 1 ? "place" : "places"} near today's walk ›`; chip.dataset.mode = "hints";
  }
  legend.hidden = !(DRIVE.size && S.legendSeen !== dk && !FRIEND && !GUIDE && TAB === "map");
}

/* ---------- after each batch of fixes ---------- */
function afterIngest() {
  if (!map) return;
  if (firstRevealPending) {
    const n = firstRevealPending; firstRevealPending = 0;
    map.setView([S.firstFix.lat, S.firstFix.lng], 16);
    toast(`You are here. <b>${n} cells</b> uncovered. Go for a walk and watch the fog lift.`, { ms: 9000 });
    geocodeCity(S.firstFix.lat, S.firstFix.lng).then(c => { if (c && !S.homeCity) { S.homeCity = c; for (const p of Object.values(S.places)) if (!p.city) p.city = c.name; save(); updateChrome(); } });
  }
  if (follow && S.last && TAB === "map" && !FRIEND) { const ll = L.latLng(S.last.lat, S.last.lng); if (!map.getBounds().pad(-0.25).contains(ll)) map.panTo(ll); }
  while (foundQueue.length) {
    const f = foundQueue.shift(), p = S.places[f.id]; if (!p) continue;
    renderPlaces();
    if (GUIDE === p.id) { GUIDE = null; renderGuide(); openPlace(p.id); }
    else toast(`New place: <b>${esc(p.n)}</b><br><span style="opacity:.75">${CATS[p.c].one} · ${C.fmtDist(f.d)}${goldenHour(p) ? " · " + goldenHour(p) : ""}</span>`, { action: "Open", fn: () => openPlace(p.id), ms: 9000 });
  }
  if (S.firstFix && !S.askedBg && WALK.size + DRIVE.size - S.firstCells >= 15 && !LAYERS.children.length) showAfterFirstWalk();
  if (S.last) ensurePlaces(S.last.lat, S.last.lng);
  if (GUIDE) renderGuide();
  maybeWelcome();
  checkHomeSuggest();
  updateChrome();
  if (now() - lastPush > 30000) { lastPush = now(); pushNative(); }
}
function goldenHour(p) {
  if (!["viewpoint", "park", "landmark"].includes(p.c)) return "";
  const ss = C.sunset(new Date(), p.lat, p.lng); if (!ss) return "";
  const min = Math.round((ss - now()) / 60000) - 45;
  return min > 0 && min < 150 ? `golden hour in ${min} min` : min <= 0 && min > -45 ? "golden hour now" : "";
}

/* ---------- places ---------- */
function openPlace(id) {
  const p = S.places[id]; if (!p) return;
  if (p.got) return openPlaceDetail(id);
  closeById("place");
  if (TAB !== "map") showTab("map");
  const d = S.last ? C.dist(S.last.lat, S.last.lng, p.lat, p.lng) : null, gh = goldenHour(p);
  const sub = [CATS[p.c].one, d != null ? C.fmtDist(d) + " away" : "", gh].filter(Boolean).join(" · ");
  sheet(p.found
    ? `<div class="tag">New place found</div><div class="t1">${esc(p.n)}</div><div class="t2">${esc(sub)}</div><div class="chips">${CATS[p.c].ideas.map(i => `<span>${esc(i[0])}</span>`).join("")}</div>
       <button class="btn" type="button" data-a="capture" data-id="${p.id}">Take photos · collect it</button><button class="btn g" type="button" data-a="guide" data-id="${p.id}">Directions</button>`
    : `<div class="tag">Hidden place</div><div class="t1">? ${esc(CATS[p.c].a)}</div><div class="t2">${esc(sub)}</div><div class="t2" style="margin-top:6px">The name shows when you're within 150 m.</div>
       <button class="btn" type="button" data-a="guide" data-id="${p.id}">Head there</button>`, { id: "place", nav: true, label: "Place" });
  if (map.getZoom() < 15) map.setView([p.lat, p.lng], 16); else map.panTo([p.lat, p.lng]);
}
function startGuide(id) {
  GUIDE = id; follow = false; closeAll();
  const p = S.places[id];
  if (S.last) map.fitBounds(L.latLngBounds([[S.last.lat, S.last.lng], [p.lat, p.lng]]).pad(0.35), { maxZoom: 17 }); else map.setView([p.lat, p.lng], 16);
  renderGuide(); updateChrome();
}
function endGuide() { GUIDE = null; follow = true; renderGuide(); updateChrome(); if (S.last) map.panTo([S.last.lat, S.last.lng]); }
function showHints() {
  const hp = hintPlaces();
  if (!hp.length) return;
  sheet(`<div class="t1" style="font-size:17px">Near today's walk</div>${hp.map(x => `<button class="row" type="button" data-a="hint" data-id="${x.p.id}"><div><b>? ${esc(CATS[x.p.c].a)}</b><div class="t2">${C.fmtDist(x.d)} · ${C.compass(C.bearing(S.last.lat, S.last.lng, x.p.lat, x.p.lng))}</div></div><span aria-hidden="true">›</span></button>`).join("")}`, { id: "hints", nav: true, label: "Nearby hints" });
}

/* ---------- capture: guided photos with the camera ---------- */
const GUIDES = {
  figure: '<circle cx="60" cy="30" r="17"/><path d="M60 48 L60 120 M60 62 L28 98 M60 62 L96 40 M60 120 L38 196 M60 120 L80 196"/>',
  sit: '<circle cx="50" cy="60" r="16"/><path d="M50 77 L54 135 L100 135 L104 196 M52 92 L84 116 M54 135 L40 196"/>',
  horizon: '<path d="M-60 140 L180 140"/><path d="M-20 140 L20 100 L45 120 L80 80 L120 140"/>',
  thirds: '<path d="M0 70 L120 70 M0 140 L120 140 M40 0 L40 210 M80 0 L80 210"/><circle cx="80" cy="140" r="8"/>',
  frame: '<rect x="4" y="4" width="112" height="202" rx="8"/><rect x="26" y="40" width="68" height="110" rx="34"/>',
  detail: '<rect x="20" y="55" width="80" height="80" rx="10"/><path d="M60 80 L60 110 M45 95 L75 95"/>'
};
let CAP = null;
function openCapture(id) {
  const p = S.places[id]; if (!p) return;
  closeById("place"); closeById("capture");
  CAP = { id, idx: 0, shots: [], done: [] };
  openLayer(`<div class="cap" id="cap"></div>`, { id: "capture", onClose: () => { CAP = null; } });
  renderCapture();
}
function renderCapture() {
  const el = $("#cap"); if (!el || !CAP) return;
  const p = S.places[CAP.id], ideas = CATS[p.c].ideas, idea = ideas[CAP.idx], last = CAP.shots[CAP.shots.length - 1];
  const n = Math.min(CAP.shots.length + 1, ideas.length);
  el.innerHTML = `<div class="vf ${last ? "" : "ph" + ((CAP.idx % 6) + 1)}" ${last ? `style="background-image:url('${thumbOf(last)}')"` : ""}></div>
    <div class="top"><button type="button" data-a="close" aria-label="Close">✕</button><span>${esc(p.n)}</span><b id="cap-count">${CAP.shots.length >= ideas.length ? "All " + ideas.length : n + " of " + ideas.length}</b></div>
    <svg class="guide" viewBox="0 0 120 210" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round">${GUIDES[idea[2]] || GUIDES.figure}</g></svg>
    <div class="idea"><b>${esc(idea[0])}</b>${esc(idea[1])}</div>
    <div class="ideas">${ideas.map((d, i) => `<button type="button" class="${i === CAP.idx ? "on" : ""}" data-a="cap-idea" data-i="${i}">${CAP.done.includes(i) ? "✓ " : ""}${esc(d[0])}</button>`).join("")}</div>
    ${CAP.shots.length ? `<div class="thumbs">${CAP.shots.slice(-3).map(s => `<i style="background-image:url('${thumbOf(s)}')"></i>`).join("")}</div>`
      : `<label class="gal">Gallery<input type="file" accept="image/*" hidden data-file="cap"></label>`}
    <label class="shutter" aria-label="Take photo"><input id="cap-input" type="file" accept="image/*" capture="environment" hidden data-file="cap"></label>
    <button class="collect" type="button" data-a="collect" ${CAP.shots.length ? "" : "disabled"}>Collect ✓</button>`;
}
function scaleImage(bmp, max, type, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
  return type === "url" ? cv.toDataURL("image/jpeg", q) : new Promise(r => cv.toBlob(r, "image/jpeg", q));
}
async function processPhoto(file, meta) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { toast("Couldn't read that photo."); return null; }
  const mid = await scaleImage(bmp, 1600, "blob", 0.85), thumb = scaleImage(bmp, 360, "url", 0.72);
  const id = uid(), m = { place: meta.place, t: now(), idea: meta.idea || "", media: null };
  try { const caps = JSON.parse(nCall("takeCaptured") || "[]"); if (caps.length) m.media = caps[caps.length - 1]; } catch (e) { /* none */ }
  try { await DB.put({ id, mid, thumb }); } catch (e) { /* storage blocked: keep the thumbnail in memory */ }
  THUMBS.set(id, thumb); S.photos[id] = m; save();
  return id;
}
async function onCaptureFile(input) {
  const f = input.files && input.files[0]; input.value = "";
  if (!f || !CAP) return;
  const p = S.places[CAP.id], idea = CATS[p.c].ideas[CAP.idx];
  const id = await processPhoto(f, { place: CAP.id, idea: idea[0] }); if (!id || !CAP) return;
  CAP.shots.push(id); if (!CAP.done.includes(CAP.idx)) CAP.done.push(CAP.idx);
  const next = CATS[p.c].ideas.findIndex((_, i) => !CAP.done.includes(i)); if (next >= 0) CAP.idx = next;
  renderCapture();
}
function collectPlace() {
  if (!CAP || !CAP.shots.length) return;
  const p = S.places[CAP.id], shots = CAP.shots.slice();
  p.got = now(); p.found = p.found || p.got; p.photos = (p.photos || []).concat(shots); p.city = p.city || cityLabelAt(p.lat, p.lng) || "Elsewhere";
  dayLog(p.got).got.push(p.id); S.newTile = p.id; save();
  closeById("capture"); renderPlaces(); pushNative();
  const same = Object.values(S.places).filter(o => o.c === p.c && o.city === p.city), got = same.filter(o => o.got).length;
  openLayer(`<div class="stampw"><div class="stampc" role="dialog" aria-label="Collected"><div class="stamp"><i style="background-image:url('${thumbOf(shots[0])}')"></i></div>
    <div class="tag" style="margin-top:14px">Collected</div><div class="t1">${esc(p.n)}</div><div class="t2" id="collected-sub">${plural(shots.length, "photo")} · ${got} of ${same.length} ${CATS[p.c].many.toLowerCase()} in ${esc(p.city)}</div>
    <div class="prog"><i style="width:${Math.round(100 * got / Math.max(1, same.length))}%"></i></div>
    <button class="btn g" type="button" data-a="add-note" data-id="${p.id}">Add a note</button><button class="btn" type="button" data-a="see-collection">See collection</button></div></div>`, { id: "collected" });
}

/* ---------- collection ---------- */
let COLL_CAT = null, COLL_CITY = null;
function renderCollection() {
  const el = $("#v-collection"), all = Object.values(S.places), got = all.filter(p => p.got);
  const cities = [...new Set(got.map(p => p.city || "Elsewhere"))];
  const cats = CAT_ORDER.filter(c => all.some(p => p.c === c));
  let html = `<div class="inner"><h1>Collection</h1><div class="muted" id="coll-sum">${plural(got.length, "place")} in ${plural(cities.length, "city", "cities")}</div>`;
  if (cats.length) html += `<div class="cats">${cats.map(c => { const k = all.filter(p => p.c === c && (!COLL_CITY || p.city === COLL_CITY)); return `<button type="button" class="${COLL_CAT === c ? "on" : ""}" data-a="coll-cat" data-cat="${c}"><b>${k.filter(p => p.got).length}/${k.length}</b><span>${CATS[c].many}</span></button>`; }).join("")}</div>`;
  const allCities = [...new Set(all.map(p => p.city || "Elsewhere"))];
  if (allCities.length > 1) html += `<div class="chips" style="margin-top:4px"><button type="button" class="chip${!COLL_CITY ? " on" : ""}" data-a="coll-city" data-city="">All cities</button>${allCities.map(c => `<button type="button" class="chip${COLL_CITY === c ? " on" : ""}" data-a="coll-city" data-city="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
  if (!got.length && !all.length) html += `<div class="empty"><div class="h1">Nothing here yet</div>Walk close to a ? on the map to find a place, then take photos to collect it.</div>`;
  let shown = 0;
  const lastIn = city => Math.max(0, ...all.filter(p => (p.city || "Elsewhere") === city).map(p => p.got || p.found || 0));
  for (const city of allCities.slice().sort((x, y) => lastIn(y) - lastIn(x))) {
    if (COLL_CITY && COLL_CITY !== city) continue;
    for (const c of cats) {
      if (COLL_CAT && COLL_CAT !== c) continue;
      const list = all.filter(p => p.c === c && (p.city || "Elsewhere") === city); if (!list.length) continue;
      const g = list.filter(p => p.got).sort((a, b) => b.got - a.got), f = list.filter(p => p.found && !p.got), u = list.filter(p => !p.found);
      if (!COLL_CAT && !all.some(p => (p.city || "Elsewhere") === city && p.found)) continue; // cities you haven't started stay out of the way
      shown++;
      html += `<div class="sec">${esc(CATS[c].many)} · ${esc(city)}</div><div class="grid3">`;
      html += g.map((p, i) => `<button type="button" ${bgAttr((p.photos || [])[0], i, "tile" + (S.newTile === p.id ? " new" : ""))} data-a="detail" data-id="${p.id}"><em>${esc(p.n)}</em></button>`).join("");
      html += f.map(p => `<button type="button" class="tile lock" data-a="place" data-id="${p.id}">✓<small>${esc(p.n)}</small></button>`).join("");
      html += u.slice(0, 3).map(p => `<button type="button" class="tile lock" data-a="place" data-id="${p.id}" aria-label="Hidden ${esc(CATS[c].one)}">?</button>`).join("");
      if (u.length > 3) html += `<div class="tile lock" style="font-size:16px">+${u.length - 3}</div>`;
      html += `</div>`;
    }
  }
  if (all.length && !shown) html += `<div class="empty"><div class="h1">${plural(all.length, "place")} to find</div>They show as ? on the map. Walk within 150 m to see what each one is.</div>`;
  el.innerHTML = html + "</div>";
}
function openPlaceDetail(id) {
  const p = S.places[id]; if (!p) return;
  if (S.newTile === id) { S.newTile = null; save(); }
  closeById("detail");
  const t = S.trips.find(tr => p.got >= tr.start && (!tr.end || p.got <= tr.end + 60000));
  const photos = p.photos || [];
  page(`${back()}<div class="mini" style="height:230px;margin:6px -16px 0;border-radius:0" ${photos[0] && thumbOf(photos[0]) ? `data-hero="${photos[0]}"` : ""}><div class="tile${photos[0] && thumbOf(photos[0]) ? "" : " ph1"}" style="aspect-ratio:auto;height:100%;border-radius:0${photos[0] && thumbOf(photos[0]) ? `;background-image:url('${thumbOf(photos[0])}')` : ""}"></div></div>
    <div class="tag" style="margin-top:14px">${esc(CATS[p.c].one)} · ${esc(p.city || "")}</div><div class="h1" style="margin-top:3px" id="detail-name">${esc(p.n)}</div>
    <div class="t2">Collected ${fmtDate(p.got)}, ${fmtTime(p.got)}${t ? ` · Day ${tripDayNo(t, dayKey(p.got))} of ${esc(t.city)} trip` : ""}</div>
    <div class="strip" id="detail-strip">${photos.map((ph, i) => `<button type="button" data-a="photo" data-id="${ph}" ${bgOf(ph, i)} aria-label="Photo ${i + 1}"></button>`).join("")}<label class="add" aria-label="Add a photo">＋<input type="file" accept="image/*" capture="environment" hidden data-file="add" data-id="${p.id}"></label></div>
    <textarea class="txt note" id="note" data-id="${p.id}" placeholder="Add a note…" aria-label="Note">${esc(p.note || "")}</textarea>
    <button class="btn g" type="button" data-a="show-on-map" data-id="${p.id}">Show on map</button>`, { id: "detail" });
  const hero = $('.layer[data-id="detail"] [data-hero]');
  if (hero) photoBlobURL(hero.dataset.hero).then(u => { if (u) $(".tile", hero).style.backgroundImage = `url('${u}')`; });
}
async function openPhoto(id) {
  const m = S.photos[id]; if (!m) return;
  const u = await photoBlobURL(id);
  openLayer(`<div class="photo-full"><img src="${u}" alt="${esc(m.idea || "Photo")}"><button class="xbtn" type="button" data-a="close" aria-label="Close">✕</button>
    <div class="bar2">${N && m.media ? `<button type="button" data-a="gallery-open" data-id="${id}">Open in gallery</button>` : ""}<button type="button" data-a="photo-del" data-id="${id}">Remove</button></div></div>`, { id: "photo" });
}

/* ---------- trips ---------- */
function onTripEnded(t) {
  toast(`Your <b>${esc(t.city)}</b> memory lane is ready`, { action: "Open", fn: () => openTrip(t.id), ms: 10000 });
  updateChrome(); pushNative();
}
function maybeWelcome() {
  const t = activeTrip();
  if (!t || t.welcomed || t.city === "New city" || document.hidden || layerOpen("welcome") || layerOpen("onb")) return;
  t.welcomed = true; save();
  const st = boxStats(t.box || C.clampBox(null, t.lat, t.lng, CITY_KM));
  const near = Object.values(S.places).filter(p => C.dist(p.lat, p.lng, t.lat, t.lng) < 2000);
  const inCity = Object.values(S.places).filter(p => t.box && C.inBox(t.box, p.lat, p.lng));
  const vp = near.filter(p => p.c === "viewpoint").length;
  if (TAB !== "map") showTab("map");
  sheet(`<div class="tag">Trip started</div><div class="t1" id="welcome-city">Welcome to ${esc(t.city)}</div>
    <div class="t2">${C.fmtPct(st.p)} uncovered${inCity.length ? " · " + plural(inCity.length, "place") + " to find" : ""}${vp ? " · " + plural(vp, "viewpoint") + " within 2 km" : ""}</div>
    <button class="btn" type="button" data-a="close">Start exploring</button>`, { id: "welcome", nav: true });
  fetchPlaces(t.lat, t.lng, { city: t.city }).then(() => { renderPlaces(); updateChrome(); }).catch(() => {});
}
function dayTitle(d) {
  const names = ((S.days[d] || {}).got || []).map(id => S.places[id] && S.places[id].n).filter(Boolean);
  return names.length ? names.slice(0, 2).join(" and ") + (names.length > 2 ? " +" + (names.length - 2) : "") : "Exploring";
}
function renderTrips() {
  const el = $("#v-trips"), cities = new Set(S.trips.map(t => t.city));
  let html = `<div class="inner"><h1>Trips</h1><div class="muted">${plural(S.trips.length, "trip")} · ${plural(cities.size, "city", "cities")}</div>`;
  const a = activeTrip();
  if (a) html += `<div class="card"><div class="tag">Now · day ${tripDayNo(a, dayKey())}</div><div class="t1">${esc(a.city)}</div><div class="chips"><button class="btn sm" type="button" data-a="recap" data-id="${a.id}" data-day="${dayKey()}">Today's recap</button><button class="btn sm g" type="button" data-a="trip" data-id="${a.id}">Memory lane</button></div></div>`;
  if (!S.trips.length) html += `<div class="empty"><div class="h1">No trips yet</div>Go more than ${TRIP_KM} km from home and a trip starts by itself. Getting ready? Search a city on the map and download it for offline.</div>`;
  html += S.trips.map((t, i) => { const st = tripStats(t), cov = tripCover(t), d = new Date(t.start);
    return `<button class="trip" type="button" data-a="trip" data-id="${t.id}"><i ${cov ? bgOf(cov, i) : `class="ph${(i % 6) + 1}"`}></i><div><b>${esc(t.city)}</b><div class="t2">${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${plural(st.days, "day")} · +${C.fmtPct(st.pct)}${t.end ? "" : " · now"}</div></div></button>`; }).join("");
  el.innerHTML = html + "</div>";
}
function openTrip(id) {
  const t = tripById(id); if (!t) return;
  if (t.end && !t.doneSeen) { t.doneSeen = true; save(); updateChrome(); }
  closeById("trip");
  const st = tripStats(t), d = new Date(t.start), stars = Object.keys(t.stars || {}).length;
  const days = tripDays(t);
  const l = page(`${back("Trips")}<h1>${esc(t.city)}, ${MONTHS[d.getMonth()]} ${d.getFullYear()}</h1><div class="muted" id="trip-sub">${plural(st.days, "day")} · ${C.fmtKm(st.km)} · ${plural(st.got, "new place")} · +${C.fmtPct(st.pct)}</div>
    <div class="mini" id="trip-map"></div>
    ${days.map(dd => { const ph = tripPhotos(t).filter(p => dayKey(S.photos[p].t) === dd); const n = ((S.days[dd] || {}).got || []).length;
      return `<div style="margin-top:14px"><button type="button" data-a="recap" data-id="${t.id}" data-day="${dd}" style="display:flex;justify-content:space-between;width:100%;text-align:left"><b>Day ${tripDayNo(t, dd)} · ${esc(dayTitle(dd))} <span class="muted small">${plural(n, "place")}</span></b><span class="muted small">Recap ›</span></button>
      ${ph.length ? `<div class="strip">${ph.slice(0, 4).map((p, i) => `<button type="button" data-a="photo" data-id="${p}" ${bgOf(p, i)}></button>`).join("")}</div>` : `<div class="t2">No photos this day.</div>`}</div>`; }).join("")}
    <div class="foot"><button class="btn" type="button" data-a="highlights" data-id="${t.id}">Make highlights${stars ? " · " + stars + " starred" : ""}</button><button class="btn g" type="button" data-a="share-trip" data-id="${t.id}">Share trip card</button>${t.end ? "" : `<button class="btn g" type="button" data-a="end-trip">End trip now</button>`}</div>`, { id: "trip" });
  const ts = TS.get(t.id);
  miniMap($("#trip-map", l), { box: t.box, walk: ts ? ts.all : new Set(), drive: null, places: Object.values(S.places).filter(p => p.got && p.got >= t.start && (!t.end || p.got <= t.end + 60000)) });
}
function openRecap(id, d) {
  const t = tripById(id); if (!t) return;
  closeById("recap");
  const dl = S.days[d] || { w: 0, got: [] }, ts = TS.get(t.id), set = ts && ts.days[d] ? ts.days[d] : new Set();
  const box = t.box || C.clampBox(null, t.lat, t.lng, CITY_KM), pct = boxStatsRaw(box, set).p;
  const ph = tripPhotos(t).filter(p => dayKey(S.photos[p].t) === d), star = (t.stars || {})[d];
  const l = page(`${back()}<div class="tag">Day ${tripDayNo(t, d)} · ${esc(t.city)}</div><h1>${esc(dayTitle(d))}</h1><div class="muted" id="recap-sub">${C.fmtKm(dl.w || 0)} · ${plural((dl.got || []).length, "place")} · +${C.fmtPct(pct)} of ${esc(t.city)}</div>
    <div class="mini" id="recap-map"></div>
    <div class="muted" style="margin-bottom:8px">${ph.length ? "Star your favourite" : "No photos this day. Collect a place to fill your recap."}</div>
    <div class="grid3">${ph.map((p, i) => `<button type="button" ${bgAttr(p, i, "tile")} data-a="star" data-id="${t.id}" data-day="${d}" data-photo="${p}" aria-pressed="${star === p}">${star === p ? '<span class="sel star">★</span>' : ""}</button>`).join("")}</div>
    <div class="foot"><button class="btn" type="button" data-a="recap-done" data-id="${t.id}" data-day="${d}">Done</button></div>`, { id: "recap" });
  miniMap($("#recap-map", l), { box, walk: set, drive: null, path: S.track.d === d ? S.track.pts : null, places: (dl.got || []).map(i => S.places[i]).filter(Boolean) });
}
let HL = null;
function openHighlights(id) {
  const t = tripById(id); if (!t) return;
  const all = tripPhotos(t);
  HL = { id, sel: (t.hl && t.hl.length ? t.hl : Object.values(t.stars || {})).filter(p => all.includes(p)).slice(0, 10) };
  closeById("hl");
  page(`${back()}<h1>Highlights</h1><div class="muted">Pick up to 10 · tap in order</div><div class="grid3" id="hl-grid" style="margin-top:12px"></div>
    <div class="foot"><button class="btn" type="button" data-a="hl-make">Create highlights card</button></div>`, { id: "hl" });
  renderHighlights();
}
function renderHighlights() {
  const t = tripById(HL.id), g = $("#hl-grid"); if (!g) return;
  const all = tripPhotos(t);
  g.innerHTML = all.length ? all.map((p, i) => { const k = HL.sel.indexOf(p); return `<button type="button" ${bgAttr(p, i, "tile")} data-a="hl-pick" data-photo="${p}" aria-pressed="${k >= 0}">${k >= 0 ? `<span class="sel">${k + 1}</span>` : ""}</button>`; }).join("") : `<div class="t2" style="grid-column:1/-1">No photos on this trip yet.</div>`;
}

/* ---------- me ---------- */
function renderMeTab() {
  const el = $("#v-me");
  const cities = new Set(S.trips.map(t => t.city)); if (S.homeCity) cities.add(S.homeCity.name);
  const countries = new Set(S.trips.map(t => t.cc).filter(Boolean)); if (S.homeCity && S.homeCity.cc) countries.add(S.homeCity.cc);
  const got = Object.values(S.places).filter(p => p.got).length, a = areaKm2();
  el.innerHTML = `<div class="inner"><div style="display:flex;justify-content:space-between;align-items:center"><h1>Me</h1><button type="button" class="fab" style="box-shadow:none;background:var(--chip)" data-a="settings" aria-label="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></div>
    <div class="mini" id="me-map"></div>
    <div class="stats3" id="me-stats">${[[cities.size, "cities"], [countries.size, "countries"], [got, "places"], [(a >= 10 ? Math.round(a) : a.toFixed(1)) + " km²", "uncovered"], [longestStreak(), "longest streak"], [C.fmtKm(S.stats.walk), "on foot"]].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>`).join("")}</div>
    <button class="btn g" type="button" data-a="share-year">Share my year</button>
    <h2>Compare with a friend</h2><div class="t2">Paste a Wander compare link to see both fog maps.</div>
    <input class="txt" id="cmp-paste" placeholder="https://rj8228.github.io/Wander/c#…" style="margin-top:8px" autocomplete="off"><button class="btn g" type="button" data-a="compare-paste">Open compare</button>
    <p class="muted tiny" style="margin-top:22px">Wander ${esc(VERSION)} · everything stays on this phone.</p></div>`;
  const box = S.homeCity ? S.homeCity.box : null;
  miniMap($("#me-map"), { box, places: Object.values(S.places).filter(p => p.got) });
}

/* ---------- settings ---------- */
function openSettings() {
  closeById("settings");
  const th = THEMES.find(t => t[0] === S.theme) || THEMES[0];
  const nOn = Object.values(S.notif).filter(Boolean).length, perms = N ? nativePerms() : null;
  page(`${back("Me")}<h1 style="margin:6px 0 8px">Settings</h1>
    <button class="row" type="button" data-a="theme-pick"><b>Theme</b><span class="r">${th[1]} ›</span></button>
    <button class="row" type="button" data-a="tracking-pick"><b>Tracking</b><span class="r">${{ smart: "Smart", always: "Always on", open: "While open" }[S.tracking]} ›</span></button>
    <button class="row" type="button" data-a="quiet-settings"><b>Quiet places</b><span class="r">${esc(S.quiet.map(q => q.name).join(", ") || "None")} ›</span></button>
    <button class="row" type="button" data-a="notif-pick"><b>Notifications</b><span class="r">${N ? nOn + " on" : "Android app"} ›</span></button>
    ${N ? `<button class="row" type="button" data-a="perm-fix"><b>Location access</b><span class="r">${perms.background ? "All the time" : perms.fine || perms.coarse ? "While using" : "Off"} ›</span></button>` : ""}
    <button class="row" type="button" data-a="name-edit"><b>Your name on shares</b><span class="r">${esc(S.name || "Not set")} ›</span></button>
    <button class="row" type="button" data-a="backup"><b>Backup and restore</b><span class="r">›</span></button>
    <button class="row" type="button" data-a="delete-ask"><b style="color:var(--warn)">Delete all my data</b><span class="r">›</span></button>
    <p class="muted tiny" style="margin-top:20px">Wander ${esc(VERSION)}. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors; places via Overpass, cities via Nominatim. Your cells, places and photos stay on this phone.</p>
    ${N ? "" : `<a class="btn g" href="${APK_URL}" target="_blank" rel="noopener">Get the Android app</a>`}`, { id: "settings" });
}
function openThemePick() {
  closeById("theme");
  page(`${back("Settings")}<h1 style="margin:6px 0 12px">Theme</h1>${THEMES.map(([k, n, bg, ac]) => `<button type="button" class="radio${S.theme === k ? " on" : ""}" data-a="theme" data-k="${k}" aria-pressed="${S.theme === k}"><div class="swatch" style="background:${bg}"><i style="background:${ac}"></i></div><b>${n}</b></button>`).join("")}`, { id: "theme" });
}
function openTrackingPick() {
  closeById("trackpick");
  const opts = [["smart", "Smart", "On when you leave a quiet place, off inside it. Best for battery."], ["always", "Always on", "Records everywhere, including quiet places (still hidden on shares)."], ["open", "Only while Wander is open", "No background tracking at all."]];
  page(`${back("Settings")}<h1 style="margin:6px 0 12px">Tracking</h1>${opts.map(([k, n, d]) => `<button type="button" class="radio${S.tracking === k ? " on" : ""}" data-a="tracking" data-k="${k}"><div><b>${n}</b><div class="t2">${d}</div></div></button>`).join("")}`, { id: "trackpick" });
}
function openQuietSettings() {
  closeById("quietset");
  page(`${back("Settings")}<h1 style="margin:6px 0 4px">Quiet places</h1><div class="t2">GPS is off inside these. Hidden on shared cards and compare links.</div>
    ${S.quiet.map(q => `<button class="row" type="button" data-a="quiet-edit" data-id="${q.id}"><div><b>${esc(q.name)}</b><div class="t2">${q.r} m${q.on === false ? " · off" : ""}</div></div><span class="r">Edit ›</span></button>`).join("")}
    <button class="row" type="button" data-a="quiet-new"><b style="color:var(--accent-ink)">＋ Add a quiet place</b><span class="r">at the map centre</span></button>`, { id: "quietset" });
}
function openQuietEdit(id) {
  const q = S.quiet.find(x => x.id === id); if (!q) return;
  closeById("quietedit");
  sheet(`<div class="t1">Edit quiet place</div><input class="txt" id="q-name" value="${esc(q.name)}" aria-label="Name" style="margin-top:8px">
    <div class="chips">${[150, 250, 400, 600].map(r => `<button type="button" class="chip${q.r === r ? " on" : ""}" data-a="q-radius" data-r="${r}">${r} m</button>`).join("")}</div>
    <button class="btn g" type="button" data-a="q-here">Move to where I am</button><button class="btn g" type="button" data-a="q-centre">Move to the map centre</button>
    <button class="btn" type="button" data-a="q-save" data-id="${q.id}">Save</button><button class="btn g" type="button" data-a="q-del" data-id="${q.id}" style="color:var(--warn)">Remove</button>`, { id: "quietedit" });
  QEDIT = Object.assign({}, q);
}
let QEDIT = null;
function openNotifPick() {
  closeById("notifpick");
  const rows = [["place", "New place nearby", "When you walk within 150 m of a ? place"], ["streak", "Streak reminder", "At 21:00 if today has no new cells yet"], ["recap", "Trip recap", "At 20:30 on each trip day"]];
  page(`${back("Settings")}<h1 style="margin:6px 0 4px">Notifications</h1><div class="t2">${N ? "The tracking notification always shows while Wander records." : "Notifications need the Android app."}</div>
    ${rows.map(([k, n, d]) => `<div class="row"><div><b>${n}</b><div class="t2">${d}</div></div><button type="button" class="sw${S.notif[k] ? " on" : ""}" role="switch" aria-checked="${!!S.notif[k]}" aria-label="${n}" data-a="notif" data-k="${k}"></button></div>`).join("")}`, { id: "notifpick" });
}
function openBackup() {
  closeById("backup");
  page(`${back("Settings")}<h1 style="margin:6px 0 4px">Backup and restore</h1><div class="t2" style="line-height:1.5">Last backup: ${S.lastBackup ? fmtDate(S.lastBackup) : "never"}. Includes cells, places, trips, notes, small copies of your photos and links to the originals (the photos stay in your gallery).</div>
    <button class="btn" type="button" data-a="export">Export backup file</button>
    <label class="btn g">Restore from a file<input type="file" accept=".json,application/json" hidden data-file="restore" id="restore-input"></label>
    <div class="t2" style="margin-top:12px">Saved ${N ? "to Downloads " : ""}as wander-backup-${dayKey()}.json</div>`, { id: "backup" });
}
async function exportBackup() {
  saveNow();
  const photos = Object.keys(S.photos).map(id => ({ id, thumb: THUMBS.get(id) || "" }));
  const text = JSON.stringify({ app: "wander", v: 1, version: VERSION, exported: new Date().toISOString(), state: JSON.parse(localStorage.getItem(KEY)), photos });
  const name = "wander-backup-" + dayKey() + ".json";
  S.lastBackup = now(); save();
  if (N && N.saveFile) nCall("saveFile", name, text);
  else downloadBlob(new Blob([text], { type: "application/json" }), name);
  toast("Backup saved as " + name);
}
function downloadBlob(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
let RESTORE = null;
async function onRestoreFile(input) {
  const f = input.files && input.files[0]; input.value = ""; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== "wander" || !data.state) throw new Error("bad");
    RESTORE = data;
    const st = data.state, cells = C.decodeCells(st.cells || "").length + C.decodeCells(st.drive || "").length;
    sheet(`<div class="t1">Restore this backup?</div><div class="t2">From ${esc((data.exported || "").slice(0, 10))}: ${cells.toLocaleString()} cells, ${Object.values(st.places || {}).filter(p => p.got).length} collected places, ${(st.trips || []).length} trips. It replaces what's on this phone now.</div>
      <button class="btn" type="button" data-a="restore-go">Restore</button><button class="btn g" type="button" data-a="close">Cancel</button>`, { id: "restoreask" });
  } catch (e) { toast("That isn't a Wander backup file."); }
}
async function applyRestore() {
  const data = RESTORE; if (!data) return;
  WIPED = true; clearTimeout(saveTimer); // the in-memory state must not be saved over the backup on the way out
  localStorage.setItem(KEY, JSON.stringify(data.state));
  try { await DB.clear(); for (const p of data.photos || []) if (p.id && p.thumb) await DB.put({ id: p.id, mid: null, thumb: p.thumb }); } catch (e) { /* storage blocked */ }
  location.replace(location.pathname);
}
async function deleteAll() {
  stopWebTracking(); nCall("reset");
  WIPED = true; clearTimeout(saveTimer); localStorage.removeItem(KEY);
  try { await DB.clear(); } catch (e) { /* none */ }
  try { if (window.caches) await caches.delete(TILE_CACHE); } catch (e) { /* none */ }
  location.replace(location.pathname);
}

/* ---------- pause ---------- */
function openPause() {
  if (!S.firstFix) return requestLocation();
  if (isPaused()) {
    sheet(`<div class="t1">${esc(pausedLabel())}</div><div class="t2">Nothing is recorded while paused.</div><button class="btn" type="button" data-a="resume">Resume tracking</button>`, { id: "pause", nav: true, label: "Paused" });
    return;
  }
  sheet(`<div class="t1" style="font-size:17px">Pause tracking</div><div class="t2">Nothing is recorded while paused.</div>
    <button class="row" type="button" data-a="pause" data-k="hour"><b>For 1 hour</b><span aria-hidden="true">›</span></button>
    <button class="row" type="button" data-a="pause" data-k="tomorrow"><b>Until tomorrow</b><span aria-hidden="true">›</span></button>
    <button class="row" type="button" data-a="pause" data-k="off"><b>Until I turn it back on</b><span aria-hidden="true">›</span></button>`, { id: "pause", nav: true, label: "Pause tracking" });
}
function setPause(v) {
  S.paused = v; save(); nCall("pause", String(v)); lastPt = null; anchor = null;
  closeById("pause"); updateChrome();
}

/* ---------- search a city, download for offline ---------- */
function openSearch() {
  closeById("search");
  sheet(`<div class="t1" style="font-size:17px">Search a city</div><form data-form="search" style="display:flex;gap:8px;margin-top:8px"><input class="txt" id="search-q" placeholder="Lisbon" autocomplete="off" aria-label="City"><button class="btn sm" type="submit">Search</button></form><div id="search-res"></div>`, { id: "search", label: "Search" });
  setTimeout(() => { const i = $("#search-q"); if (i) i.focus(); }, 50);
}
let SEARCH = [];
async function runSearch(q) {
  const out = $("#search-res"); if (!q.trim() || !out) return;
  out.innerHTML = `<div class="t2" style="margin-top:10px">Searching…</div>`;
  try { SEARCH = await searchCities(q); } catch (e) { out.innerHTML = `<div class="t2" style="margin-top:10px">Couldn't search right now. Check your connection.</div>`; return; }
  out.innerHTML = SEARCH.length ? SEARCH.map((r, i) => `<button class="row" type="button" data-a="city" data-i="${i}"><div><b>${esc(r.name)}</b><div class="t2">${esc(r.label)}</div></div><span aria-hidden="true">›</span></button>`).join("") : `<div class="t2" style="margin-top:10px">No places found.</div>`;
}
let CITY = null;
function openCity(i) {
  const c = SEARCH[i]; if (!c) return; CITY = c;
  closeById("search"); closeById("city");
  map.fitBounds([[c.box[0], c.box[1]], [c.box[2], c.box[3]]]);
  const km2 = C.boxAreaKm2(c.box), cells = C.boxCells(c.box), tiles = tileList(c.box).length;
  sheet(`<div class="tag">Before you go</div><div class="t1">${esc(c.name)}${c.country ? ", " + esc(c.country) : ""}</div><div class="t2" id="city-sub">${Math.round(km2)} km² · ${cells.toLocaleString()} cells · <span id="city-places">finding places…</span></div>
    <div class="t2" style="margin-top:6px">Offline map and places: about ${Math.max(1, Math.round(tiles * 0.018))} MB. Best on wifi.</div>
    <div id="city-prog"></div><button class="btn" type="button" data-a="download" id="dl-btn">Download for offline</button>`, { id: "city", nav: true, label: "City" });
  fetchPlaces(c.lat, c.lng, { box: c.box, city: c.name }).then(() => { const n = Object.values(S.places).filter(p => C.inBox(c.box, p.lat, p.lng)).length; const el = $("#city-places"); if (el) el.textContent = plural(n, "place") + " to find"; renderPlaces(); })
    .catch(() => { const el = $("#city-places"); if (el) el.textContent = "places load when you arrive"; });
}
function tileList(box) {
  const out = [];
  for (let z = 12; z <= 15; z++) {
    const n = Math.pow(2, z), tx = lng => Math.floor((lng + 180) / 360 * n), ty = lat => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    for (let x = tx(box[1]); x <= tx(box[3]); x++) for (let y = ty(box[2]); y <= ty(box[0]); y++) out.push(TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y));
  }
  // keep it modest: OpenStreetMap's tile servers are shared, so cap the prefetch and prefer the centre
  return out.slice(0, 400);
}
async function downloadCity() {
  const c = CITY; if (!c) return;
  const btn = $("#dl-btn"), prog = $("#city-prog"); if (btn) btn.disabled = true;
  if (navigator.connection && navigator.connection.type === "cellular" && prog) prog.innerHTML = `<div class="t2" style="margin-top:8px">You're on mobile data.</div>`;
  const list = tileList(c.box); let done = 0, ok = 0;
  const step = () => { if (prog) prog.innerHTML = `<div class="prog"><i style="width:${Math.round(100 * done / list.length)}%"></i></div><div class="t2" style="margin-top:6px">Map ${done} of ${list.length}</div>`; };
  step();
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(list.slice(i, i + 4).map(u => tileBlob(u).then(() => ok++).catch(() => {}).finally(() => { done++; })));
    step();
  }
  let places = Object.values(S.places).filter(p => C.inBox(c.box, p.lat, p.lng)).length;
  if (!places) { try { await fetchPlaces(c.lat, c.lng, { box: c.box, city: c.name }); } catch (e) { /* later */ } places = Object.values(S.places).filter(p => C.inBox(c.box, p.lat, p.lng)).length; }
  S.offline[c.name + "|" + c.cc] = { name: c.name, country: c.country, cc: c.cc, lat: c.lat, lng: c.lng, box: c.box, tiles: ok, places, t: now() }; save();
  if (prog) prog.innerHTML = `<div class="t2" style="margin-top:8px" id="dl-done">Saved for offline · ${ok} map tiles · ${plural(places, "place")}</div>`;
  if (btn) { btn.textContent = "Downloaded"; }
  renderPlaces();
}

/* ---------- share cards and compare links ---------- */
let CARD = null;
async function openShare(kind, o = {}) {
  closeById("share");
  const l = openLayer(`<div class="sharep"><button class="close" type="button" data-a="close" aria-label="Close">✕</button><div class="imgw"><div style="color:#fff;opacity:.7" id="card-wait">Making your card…</div></div>
    <div class="acts"><button type="button" data-a="share-to" data-k="stories">Stories</button><button type="button" data-a="share-to" data-k="whatsapp">WhatsApp</button><button type="button" data-a="share-to" data-k="save">Save</button><button type="button" data-a="compare-link">Compare link</button></div></div>`, { id: "share" });
  const cv = await makeCard(kind, o);
  const url = cv.toDataURL("image/png");
  const c = ctxCity(), t = o.trip;
  const text = kind === "trip" || kind === "highlights" ? `My ${t.city} trip on Wander` : kind === "year" ? "My year on Wander" : `I uncovered ${c ? C.fmtPct(boxStats(c.box).p) + " of " + c.name : "my map"} with Wander`;
  CARD = { url, text, kind, w: cv.width, h: cv.height };
  const w = $(".imgw", l); if (w) w.innerHTML = `<img id="card-img" src="${url}" alt="${esc(text)}" width="${cv.width}" height="${cv.height}">`;
}
async function shareTo(k) {
  if (!CARD) return;
  const b64 = CARD.url.split(",")[1], name = "wander-" + dayKey() + ".png";
  if (N) {
    if (k === "save") nCall("saveImage", b64, name); else nCall("shareImage", b64, CARD.text, k);
    return;
  }
  const blob = await (await fetch(CARD.url)).blob(), file = new File([blob], name, { type: "image/png" });
  if (k !== "save" && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text: CARD.text }); return; } catch (e) { if (e.name === "AbortError") return; } }
  downloadBlob(blob, name);
  if (k === "whatsapp") toast("Card saved. Attach it in WhatsApp.");
}
async function makeCompareLink(box, label) {
  const c = ctxCity();
  box = box || (c ? c.box : S.last ? C.clampBox(null, S.last.lat, S.last.lng, CITY_KM) : null);
  if (!box) throw new Error("Nothing to share yet");
  const x1 = C.mx(box[1]), x2 = C.mx(box[3]), y1 = C.my(box[0]), y2 = C.my(box[2]), keys = [];
  for (const s of [WALK, DRIVE]) for (const k of s) {
    const xy = C.cellXY(k); if (xy[0] < x1 || xy[0] > x2 || xy[1] < y1 || xy[1] > y2) continue;
    const ll = C.cellLatLng(k); if (nearQuiet(ll[0], ll[1], 60)) continue; // home and other quiet places never leave the phone
    keys.push(k); if (keys.length >= 30000) break;
  }
  const st = boxStatsRaw(box, new Set(keys));
  const meta = { v: 1, n: S.name || "A friend", c: label || (c ? c.name : "My area"), b: box.map(v => +v.toFixed(4)), p: +st.p.toFixed(2), d: dayKey() };
  return COMPARE_BASE + await C.packCompare(meta, keys);
}
async function shareCompare(box, label) {
  if (!S.name) return askName(() => shareCompare(box, label));
  let link; try { link = await makeCompareLink(box, label); } catch (e) { toast("Walk a little first, then share your map."); return; }
  const c = FRIEND ? { name: label } : ctxCity();
  const text = `${S.name} uncovered ${c ? C.fmtPct(boxStatsRaw(box || c.box, WALK, DRIVE).p) + " of " + c.name : "this"} on Wander. Compare your fog maps: ${link}`;
  if (N) { nCall("share", text); return; }
  closeById("link");
  sheet(`<div class="t1">Your compare link</div><div class="t2">It holds your uncovered cells (never your quiet places). Anyone with the link sees them.</div><div class="linkbox" id="link-text">${esc(link)}</div>
    <button class="btn" type="button" data-a="link-share">Share</button><button class="btn g" type="button" data-a="link-copy">Copy link</button>`, { id: "link" });
  LINK = { link, text };
}
let LINK = null;
function askName(then) {
  closeById("name");
  sheet(`<div class="t1">Your name on shared cards</div><div class="t2">Friends see it on compare links.</div><form data-form="name"><input class="txt" id="name-in" value="${esc(S.name)}" placeholder="Your first name" maxlength="24" style="margin-top:10px" aria-label="Name" autocomplete="given-name"><button class="btn" type="submit">Save</button></form>`, { id: "name" });
  NAME_THEN = then;
}
let NAME_THEN = null;
async function openCompare(str) {
  try {
    const r = await C.unpackCompare(str);
    if (!r.meta || !Array.isArray(r.meta.b)) throw new Error("bad");
    FRIEND = { meta: r.meta, cells: new Set(r.cells) };
  } catch (e) { toast("That compare link doesn't look right."); return false; }
  closeAll(); showTab("map"); follow = false; GUIDE = null; renderGuide();
  const b = C.fitBox([FRIEND.cells], FRIEND.meta.b, 1.5, 0.4); map.fitBounds([[b[0], b[1]], [b[2], b[3]]]);
  redrawFog(); updateChrome();
  return true;
}
function endCompare() { FRIEND = null; redrawFog(); updateChrome(); if (location.hash) history.replaceState(null, "", location.pathname + location.search); }

/* ---------- actions ---------- */
const ACT = {
  close: () => closeTop(),
  "intro-next": el => showIntro(Number($(".onb", el.closest(".layer")).dataset.slide) + 1),
  "intro-go": () => { S.intro = true; save(); showWhyLocation(); },
  "loc-continue": () => requestLocation(),
  "loc-retry": () => { closeById("denied"); requestLocation(); },
  "open-settings": () => nCall("openAppSettings"),
  "bg-allow": () => showWhyBackground(),
  "bg-later": () => { closeById("firstwalk"); showQuietSetup(); },
  "bg-settings": async () => { closeById("onb"); await askNative("background"); showQuietSetup(); },
  "bg-skip": () => { closeById("onb"); showQuietSetup(); },
  "qd-toggle": el => { const q = QDRAFT[+el.dataset.i]; q.on = q.on === false; el.classList.toggle("on", q.on); el.setAttribute("aria-checked", q.on); },
  "qd-add": () => { const c = map.getCenter(); QDRAFT.push({ id: uid(), name: QDRAFT.some(q => q.name === "Office") ? "Quiet place " + (QDRAFT.length + 1) : "Office", lat: c.lat, lng: c.lng, r: 250, on: true, hint: "Map centre" }); closeById("quiet"); showQuietSetup(); },
  "qd-save": () => { const list = QDRAFT || []; QDRAFT = null; closeById("quiet"); saveQuiet(list); const names = S.quiet.filter(q => q.on !== false).map(q => q.name.toLowerCase());
    toast(names.length ? `Tracking is off at ${names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : "your " + names[0]}. Change it in Me → Settings → Quiet places.` : "No quiet places. Tracking stays on everywhere.", { ms: 7000 }); },
  "home-set": () => { closeById("homeask"); S.quiet.unshift({ id: uid(), name: "Home", lat: S.last.lat, lng: S.last.lng, r: 400, on: true }); saveQuiet(S.quiet); toast("Home is now a quiet place."); },
  guide: el => startGuide(el.dataset.id),
  "guide-end": () => endGuide(),
  hint: el => { closeById("hints"); startGuide(el.dataset.id); },
  place: el => openPlace(el.dataset.id),
  detail: el => openPlaceDetail(el.dataset.id),
  capture: el => openCapture(el.dataset.id),
  "cap-idea": el => { CAP.idx = +el.dataset.i; renderCapture(); },
  collect: () => collectPlace(),
  "see-collection": () => { closeAll(); showTab("collection"); },
  "add-note": el => { closeAll(); openPlaceDetail(el.dataset.id); setTimeout(() => { const n = $("#note"); if (n) n.focus(); }, 60); },
  "show-on-map": el => { const p = S.places[el.dataset.id]; closeAll(); showTab("map"); follow = false; map.setView([p.lat, p.lng], 17); },
  photo: el => openPhoto(el.dataset.id),
  "gallery-open": el => nCall("openMedia", S.photos[el.dataset.id].media),
  "photo-del": el => { const id = el.dataset.id, m = S.photos[id]; if (m && S.places[m.place]) S.places[m.place].photos = (S.places[m.place].photos || []).filter(x => x !== id); delete S.photos[id]; THUMBS.delete(id); DB.del(id).catch(() => {}); for (const t of S.trips) { for (const d in t.stars || {}) if (t.stars[d] === id) delete t.stars[d]; t.hl = (t.hl || []).filter(x => x !== id); } save(); closeTop(); const det = $('.layer[data-id="detail"] #note'); if (det) openPlaceDetail(det.dataset.id); },
  "coll-cat": el => { COLL_CAT = COLL_CAT === el.dataset.cat ? null : el.dataset.cat; renderCollection(); },
  "coll-city": el => { COLL_CITY = el.dataset.city || null; renderCollection(); },
  trip: el => openTrip(el.dataset.id),
  recap: el => openRecap(el.dataset.id, el.dataset.day),
  star: el => { const t = tripById(el.dataset.id); t.stars = t.stars || {}; t.stars[el.dataset.day] = t.stars[el.dataset.day] === el.dataset.photo ? undefined : el.dataset.photo; if (!t.stars[el.dataset.day]) delete t.stars[el.dataset.day]; save(); openRecap(t.id, el.dataset.day); },
  "recap-done": el => { const t = tripById(el.dataset.id); t.recapSeen = t.recapSeen || {}; t.recapSeen[el.dataset.day] = true; save(); closeById("recap"); updateChrome(); if (layerOpen("trip")) openTrip(t.id); },
  highlights: el => openHighlights(el.dataset.id),
  "hl-pick": el => { const p = el.dataset.photo, i = HL.sel.indexOf(p); if (i >= 0) HL.sel.splice(i, 1); else if (HL.sel.length < 10) HL.sel.push(p); else toast("Up to 10 photos."); renderHighlights(); },
  "hl-make": () => { const t = tripById(HL.id); t.hl = HL.sel.slice(); save(); openShare("highlights", { trip: t, photos: t.hl }); },
  "share-trip": el => openShare("trip", { trip: tripById(el.dataset.id) }),
  "end-trip": () => { endTrip(now()); closeById("trip"); renderTrips(); },
  "share-year": () => openShare("year"),
  "share-to": el => shareTo(el.dataset.k),
  "compare-link": () => shareCompare(),
  "link-share": async () => { if (navigator.share) { try { await navigator.share({ text: LINK.text }); return; } catch (e) { if (e.name === "AbortError") return; } } window.open("https://wa.me/?text=" + encodeURIComponent(LINK.text), "_blank"); },
  "link-copy": async () => { try { await navigator.clipboard.writeText(LINK.link); toast("Link copied"); } catch (e) { toast("Select the link and copy it."); } },
  "compare-end": () => endCompare(),
  "compare-paste": () => { const v = $("#cmp-paste").value; if (v.trim()) openCompare(v); },
  settings: () => openSettings(),
  "theme-pick": () => openThemePick(),
  theme: el => { S.theme = el.dataset.k; save(); applyTheme(); openThemePick(); },
  "tracking-pick": () => openTrackingPick(),
  tracking: el => { S.tracking = el.dataset.k; save(); nCall("startTracking", S.tracking); openTrackingPick(); updateChrome(); },
  "quiet-settings": () => openQuietSettings(),
  "quiet-edit": el => openQuietEdit(el.dataset.id),
  "quiet-new": () => { const c = map.getCenter(); const q = { id: uid(), name: S.quiet.some(x => x.name === "Office") ? "Quiet place" : "Office", lat: c.lat, lng: c.lng, r: 250, on: true }; S.quiet.push(q); saveQuiet(S.quiet); openQuietSettings(); openQuietEdit(q.id); },
  "q-radius": el => { QEDIT.r = +el.dataset.r; $$('[data-a="q-radius"]').forEach(b => b.classList.toggle("on", b === el)); },
  "q-here": () => { if (S.last) { QEDIT.lat = S.last.lat; QEDIT.lng = S.last.lng; toast("Moved to where you are. Save to keep it."); } },
  "q-centre": () => { const c = map.getCenter(); QEDIT.lat = c.lat; QEDIT.lng = c.lng; toast("Moved to the map centre. Save to keep it."); },
  "q-save": () => { QEDIT.name = ($("#q-name").value || "").trim() || QEDIT.name; S.quiet = S.quiet.map(q => q.id === QEDIT.id ? QEDIT : q); saveQuiet(S.quiet); closeById("quietedit"); openQuietSettings(); },
  "q-del": el => { S.quiet = S.quiet.filter(q => q.id !== el.dataset.id); saveQuiet(S.quiet); closeById("quietedit"); openQuietSettings(); },
  "notif-pick": () => openNotifPick(),
  notif: el => { const k = el.dataset.k; S.notif[k] = !S.notif[k]; save(); pushNative(); el.classList.toggle("on", S.notif[k]); el.setAttribute("aria-checked", S.notif[k]); if (S.notif[k] && N) { const p = nativePerms(); if (p.sdk >= 33 && !p.notify) askNative("notifications"); } },
  "perm-fix": async () => { const p = nativePerms(); if (!p.fine && !p.coarse) await askNative("location"); else if (!p.background) await askNative("background"); else nCall("openAppSettings"); openSettings(); },
  "name-edit": () => askName(() => { if (layerOpen("settings")) openSettings(); }),
  backup: () => openBackup(),
  export: () => exportBackup(),
  "restore-go": () => applyRestore(),
  "delete-ask": () => sheet(`<div class="t1">Delete all your data?</div><div class="t2">Cells, places, trips, notes and settings are removed from this phone. Photos in your gallery stay. This can't be undone, so export a backup first if you might want it.</div>
    <button class="btn danger" type="button" data-a="delete-go">Delete everything</button><button class="btn g" type="button" data-a="close">Cancel</button>`, { id: "deleteask" }),
  "delete-go": () => deleteAll(),
  pause: el => { const k = el.dataset.k, d = new Date(); if (k === "hour") setPause(now() + 3600e3); else if (k === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); setPause(d.getTime()); } else setPause(-1); },
  resume: () => setPause(0),
  download: () => downloadCity(),
  city: el => openCity(+el.dataset.i)
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-a]"); if (!el) return;
  const fn = ACT[el.dataset.a]; if (!fn) return;
  e.preventDefault(); fn(el, e);
});
document.addEventListener("change", e => {
  const el = e.target; if (!el.dataset || !el.dataset.file) return;
  if (el.dataset.file === "cap") onCaptureFile(el);
  else if (el.dataset.file === "restore") onRestoreFile(el);
  else if (el.dataset.file === "add") { const f = el.files && el.files[0], id = el.dataset.id; el.value = ""; if (f) processPhoto(f, { place: id }).then(ph => { if (ph) { S.places[id].photos = (S.places[id].photos || []).concat(ph); save(); openPlaceDetail(id); } }); }
});
document.addEventListener("input", e => { if (e.target.id === "note") { const p = S.places[e.target.dataset.id]; if (p) { p.note = e.target.value; save(); } } });
document.addEventListener("submit", e => {
  const f = e.target.dataset.form; if (!f) return; e.preventDefault();
  if (f === "search") runSearch($("#search-q").value);
  if (f === "name") { S.name = ($("#name-in").value || "").trim().slice(0, 24); save(); closeById("name"); const then = NAME_THEN; NAME_THEN = null; if (S.name && then) then(); }
});

/* ---------- launch links: #c=… compare links, notification taps ---------- */
function handleLaunch(l) {
  if (!l) return;
  if (l.link) openCompare(l.link);
  if (l.place && S.places[l.place]) openPlace(l.place);
  if (l.screen === "recap") { const t = activeTrip() || S.trips[0]; if (t) openRecap(t.id, l.day || dayKey()); }
  if (l.screen === "trip") { const t = tripById(l.trip) || S.trips[0]; if (t) openTrip(t.id); }
  if (l.screen === "pause") openPause();
}
window.wanderLaunch = () => { pollNative(); try { handleLaunch(JSON.parse(nCall("takeLaunch") || "null")); } catch (e) { /* none */ } };

/* ---------- boot ---------- */
async function boot() {
  load(); applyTheme(); initMap(); renderQuiet(); renderPath(); renderPlaces();
  await loadThumbs();
  $$("#nav button").forEach(b => b.addEventListener("click", () => { closeAll(); showTab(b.dataset.tab); }));
  $("#pill").addEventListener("click", openPause);
  $("#fab-share").addEventListener("click", () => openShare("city"));
  $("#fab-locate").addEventListener("click", () => { follow = true; const me = S.last; if (me) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 16)); else if (!S.firstFix) requestLocation(); });
  $("#fab-search").addEventListener("click", openSearch);
  $("#chip").addEventListener("click", e => { const m = e.currentTarget.dataset.mode; const t = activeTrip();
    if (m === "hints") showHints(); else if (m === "recap" && t) openRecap(t.id, dayKey());
    else if (m === "gmaps" && GUIDE) { const p = S.places[GUIDE], u = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`; if (N) nCall("openUrl", u); else window.open(u, "_blank", "noopener"); }
    else if (m === "sendback" && FRIEND) shareCompare(FRIEND.meta.b, FRIEND.meta.c); });
  $("#legend").addEventListener("click", () => { S.legendSeen = dayKey(); save(); updateChrome(); });
  updateChrome();
  if (!S.firstFix) { if (!S.intro) showIntro(0); else showWhyLocation(); }
  else if (N) { const p = nativePerms(); if (p.fine || p.coarse) nCall("startTracking", S.tracking); pollNative(); }
  else startWebTracking();
  if (S.firstFix && !S.homeCity) geocodeCity(S.firstFix.lat, S.firstFix.lng).then(c => { if (c) { S.homeCity = c; save(); updateChrome(); } });
  if (S.firstFix && !S.askedBg && WALK.size + DRIVE.size - S.firstCells >= 15) showAfterFirstWalk();
  else if (S.askedBg && !S.quietAsked) showQuietSetup();
  const h = location.hash.match(/^#c=([AB][A-Za-z0-9_-]+)/); if (h) openCompare(h[1]);
  addEventListener("hashchange", () => { const m = location.hash.match(/^#c=([AB][A-Za-z0-9_-]+)/); if (m) openCompare(m[1]); });
  if (N) window.wanderLaunch();
  setInterval(() => { if (!document.hidden) pollNative(); }, 4000);
  setInterval(() => { if (!document.hidden) updateChrome(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) { saveNow(); pushNative(); } else { pollNative(); maybeWelcome(); if (S.last) ensurePlaces(S.last.lat, S.last.lng); } });
  pushNative();
  window.__wander = { map, get S() { return S; }, get WALK() { return WALK; }, get DRIVE() { return DRIVE; }, get FRIEND() { return FRIEND; }, ingest, saveNow, makeCompareLink, C, boxStats, ctxCity, streak, get CARD() { return CARD; } };
}
if (N) {
  if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).catch(() => {});
} else if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
