// Wander end-to-end test: walks through all 7 journeys from the screens spec in the browser build, then the Android
// bridge paths with a stubbed WanderNative. Offline and deterministic: map tiles, Overpass and Nominatim come from
// fixtures, GPS is mocked with context.setGeolocation (walks are stepped positions) and time with page.clock.
// Run from the repo root:  python3 -m http.server 8788 --bind 127.0.0.1 &   NODE_PATH=$(npm root -g) node tests/e2e.js
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const C = require("../core.js");
const U = process.env.WANDER_URL || "http://127.0.0.1:8788/";
const FIX = path.join(__dirname, "fixtures"), OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

let J = "setup", passes = 0, fails = 0; const results = {};
function ok(cond, msg) {
  const r = results[J] || (results[J] = { pass: 0, fail: 0 });
  if (cond) { passes++; r.pass++; } else { fails++; r.fail++; console.log(`FAIL [${J}] ${msg}`); }
}

/* ---------- fixtures: places, cities, tiles ---------- */
const HOME = [18.5204, 73.8567];
const LISBON = [38.7139, -9.1334];
const PLACES = [
  { type: "node", id: 1001, lat: 18.5240, lon: 73.8620, tags: { tourism: "viewpoint", name: "Parvati Hill Viewpoint" } },
  { type: "way", id: 1002, center: { lat: 18.5262, lon: 73.8519 }, tags: { leisure: "park", name: "Saras Baug" } },
  { type: "node", id: 1003, lat: 18.5130, lon: 73.8590, tags: { amenity: "cafe", name: "Vohuman Cafe" } },
  { type: "node", id: 1004, lat: 18.5300, lon: 73.8700, tags: { tourism: "museum", name: "Raja Dinkar Kelkar Museum" } },
  { type: "node", id: 1005, lat: 18.5195, lon: 73.8556, tags: { historic: "memorial", name: "Home Corner Memorial" } },
  { type: "node", id: 2001, lat: 38.7166, lon: -9.1310, tags: { tourism: "viewpoint", name: "Miradouro da Graça" } },
  { type: "node", id: 2002, lat: 38.7139, lon: -9.1335, tags: { historic: "castle", name: "Castelo de São Jorge" } },
  { type: "node", id: 2003, lat: 38.7107, lon: -9.1424, tags: { amenity: "cafe", name: "Café A Brasileira" } },
  { type: "way", id: 2004, center: { lat: 38.7139, lon: -9.1597 }, tags: { leisure: "park", name: "Jardim da Estrela" } },
  { type: "node", id: 2005, lat: 38.7115, lon: -9.1300, tags: { tourism: "artwork", name: "Tram 28 mural" } }
];
const CITIES = {
  pune: { lat: "18.5214", lon: "73.8545", name: "Pune", address: { city: "Pune", state: "Maharashtra", country: "India", country_code: "in" }, boundingbox: ["18.43", "18.62", "73.74", "73.98"], display_name: "Pune, Maharashtra, India" },
  lisbon: { lat: "38.7077", lon: "-9.1366", name: "Lisbon", address: { city: "Lisbon", country: "Portugal", country_code: "pt" }, boundingbox: ["38.6914", "38.7967", "-9.2298", "-9.0866"], display_name: "Lisbon, Portugal" }
};
const counters = { tiles: 0, overpass: 0, nominatim: 0 };
async function routes(ctx) {
  const tile = fs.readFileSync(path.join(FIX, "tile.png"));
  await ctx.route(/^https:\/\/tile\.openstreetmap\.org\//, r => { counters.tiles++; r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: tile }); });
  await ctx.route(/overpass/, r => {
    counters.overpass++;
    const q = decodeURIComponent((r.request().postData() || "").replace(/^data=/, "").replace(/\+/g, " "));
    let inside;
    const around = q.match(/around:(\d+),([-\d.]+),([-\d.]+)/), box = q.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
    if (around) { const [, m, la, lo] = around.map(Number); inside = (a, b) => C.dist(la, lo, a, b) <= Math.max(m, 4000); }
    else if (box) { const [, s, w, n, e] = box.map(Number); inside = (a, b) => a >= s && a <= n && b >= w && b <= e; }
    else inside = () => false;
    const elements = PLACES.filter(p => inside(p.lat ?? p.center.lat, p.lon ?? p.center.lon));
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ elements }) });
  });
  await ctx.route(/nominatim\.openstreetmap\.org/, r => {
    counters.nominatim++;
    const u = new URL(r.request().url());
    let body;
    if (u.pathname.includes("reverse")) body = +u.searchParams.get("lat") > 30 ? CITIES.lisbon : CITIES.pune;
    else body = /lisb/i.test(u.searchParams.get("q") || "") ? [CITIES.lisbon] : [];
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
}

/* ---------- helpers: time, GPS, waiting ---------- */
let T = 0;
const at = s => new Date(s).getTime();
async function setTime(p, t) { T = t; await p.clock.setFixedTime(T); }
async function goTo(p, lat, lng, dtMs = 10000) {
  T += dtMs; await p.clock.setFixedTime(T);
  await p.context().setGeolocation({ latitude: lat, longitude: lng, accuracy: 8 });
  await p.waitForFunction(([la, ln, t]) => window.__wander && __wander.S.last && Math.abs(__wander.S.last.lat - la) < 1e-7 && Math.abs(__wander.S.last.lng - ln) < 1e-7 && __wander.S.last.t === t, [lat, lng, T], { timeout: 5000 })
    .catch(() => ok(false, `fix ${lat.toFixed(5)},${lng.toFixed(5)} reached the app`));
}
async function walk(p, from, to, stepM = 20, dtMs = 10000) {
  const n = Math.max(1, Math.round(C.dist(from[0], from[1], to[0], to[1]) / stepM));
  for (let i = 1; i <= n; i++) await goTo(p, from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n, dtMs);
  return to;
}
const offset = (pt, northM, eastM) => [pt[0] + northM / 111320, pt[1] + eastM / (111320 * Math.cos(pt[0] * Math.PI / 180))];
const W = p => p.evaluate(() => ({ walk: __wander.WALK.size, drive: __wander.DRIVE.size }));
const st = (p, fn) => p.evaluate(fn);
const text = async (p, sel) => (await p.locator(sel).first().textContent({ timeout: 4000 }).catch(() => "")) || "";
const visible = (p, sel, timeout = 4000) => p.locator(sel).first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
const hideToast = p => p.evaluate(() => { const t = document.getElementById("toast"); if (t) t.hidden = true; });
async function closeLayers(p) { await p.evaluate(() => { while (document.querySelector("#layers .layer")) window.wanderBack(); }); }
async function tab(p, name) { await closeLayers(p); await p.click(`#nav [data-tab="${name}"]`); }
function pngSize(buf) { return buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a" ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null; }

async function newPage(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, timezoneId: "Asia/Kolkata", locale: "en-GB", acceptDownloads: true,
    geolocation: { latitude: (opts.start || HOME)[0], longitude: (opts.start || HOME)[1], accuracy: 8 }, permissions: ["geolocation", "clipboard-read", "clipboard-write"] });
  await routes(ctx);
  if (opts.init) await ctx.addInitScript(opts.init);
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/favicon|ERR_FILE_NOT_FOUND/.test(m.text())) p.errors.push(m.text()); });
  return p;
}
async function onboard(p) {
  await p.click("[data-a=intro-go]"); await p.click("[data-a=loc-continue]");
  await p.waitForFunction(() => __wander.S.firstFix, null, { timeout: 8000 });
}

(async () => {
  const b = await chromium.launch();
  const p = await newPage(b);
  await setTime(p, at("2026-10-22T09:00:00+05:30"));

  /* ===== Journey 1: first run ===== */
  J = "1 First run";
  await p.goto(U);
  ok(await visible(p, ".onb"), "intro shows on first launch");
  ok((await text(p, ".onb .h1")).includes("The world is dark"), "intro slide 1 headline");
  await p.click("[data-a=intro-next]");
  ok((await text(p, ".onb .h1")).includes("Find places"), "intro slide 2 after Next");
  await p.click("[data-a=intro-go]");
  ok((await text(p, ".onb .h1")).includes("Wander needs your location"), "why-location screen");
  await p.click("[data-a=loc-continue]");
  await p.waitForFunction(() => __wander.S.firstFix, null, { timeout: 8000 }).catch(() => {});
  let c = await W(p);
  ok(c.walk >= 5, `first reveal uncovers cells around you (${c.walk})`);
  ok(/You are here\. \d+ cells uncovered/.test(await text(p, "#toast")), "first-reveal toast");
  await p.waitForFunction(() => document.querySelector("#hud-city") && document.querySelector("#hud-city").textContent === "Pune", null, { timeout: 5000 }).catch(() => {});
  ok((await text(p, "#hud-city")) === "Pune", "HUD names the home city");
  ok((await text(p, "#pill")).includes("Tracking while open"), "tracking pill in the browser build");
  const fogPainted = await p.evaluate(() => { const cv = document.querySelector(".fog-canvas"); const d = cv.getContext("2d").getImageData(cv.width / 2, cv.height / 2, 1, 1).data, e = cv.getContext("2d").getImageData(5, 5, 1, 1).data; return { centre: d[3], edge: e[3] }; });
  ok(fogPainted.edge > 200 && fogPainted.centre < fogPainted.edge, `fog canvas has a hole where you are (centre alpha ${fogPainted.centre}, edge ${fogPainted.edge})`);
  // first walk: 600 m east
  let pos = await walk(p, HOME, offset(HOME, 0, 800), 25, 12000);
  c = await W(p);
  ok(c.walk >= 22 && c.drive === 0, `walking uncovers a trail of walked cells (${c.walk} walked, ${c.drive} driven)`);
  ok(await visible(p, '.layer[data-id="firstwalk"]'), "after the first walk, the background-location ask appears");
  ok(/Nice first walk · \d+ cells/.test(await text(p, '.layer[data-id="firstwalk"] .tag')), "first-walk sheet counts cells");
  await p.click("[data-a=bg-allow]");
  ok((await text(p, ".onb .h1")).includes("screen off"), "background explanation screen");
  await p.click("[data-a=bg-skip]");
  ok(await visible(p, '.layer[data-id="quiet"]'), "quiet places setup after the background step");
  ok((await text(p, '.layer[data-id="quiet"]')).includes("Home"), "Home is suggested as a quiet place");
  await p.evaluate(() => __wander.map.setView([18.575, 73.79], 15));
  await p.click("[data-a=qd-add]");
  ok((await text(p, '.layer[data-id="quiet"]')).includes("Office"), "added an Office quiet place");
  await p.click("[data-a=qd-save]");
  let q = await st(p, () => __wander.S.quiet);
  ok(q.length === 2 && q[0].name === "Home" && q[0].r === 250 && Math.abs(q[0].lat - 18.5204) < 1e-3, "quiet places saved (Home 250 m at the first fix, Office)");
  ok((await text(p, "#toast")).includes("Tracking is off at home and office"), "quiet places toast");
  ok(await p.locator(".pin-quiet").count() === 2, "quiet places drawn on the map");
  await p.reload(); await p.waitForTimeout(300);
  ok(!(await p.locator(".onb").count()) && (await W(p)).walk === c.walk, "after reload: no intro, cells kept");

  /* ===== Journey 2: everyday explore ===== */
  J = "2 Everyday explore";
  await goTo(p, ...HOME, 60000);
  const atHome = await W(p);
  await goTo(p, ...offset(HOME, 50, 30), 30000);
  ok((await W(p)).walk === atHome.walk, "nothing is recorded inside the Home quiet place");
  ok((await text(p, "#pill")).includes("Home · quiet"), "pill shows you're in a quiet place");
  const leave = offset(HOME, -400, 0);
  await goTo(p, ...leave, 120000);
  ok(!(await text(p, "#pill")).includes("quiet"), "tracking resumes after leaving the quiet place");
  const before = await W(p);
  pos = await walk(p, leave, offset(leave, -3000, 0), 250, 10000); // 25 m/s: driving
  c = await W(p);
  ok(c.drive > before.drive + 20, `driving uncovers driven cells (${c.drive - before.drive})`);
  ok(await visible(p, "#legend"), "walked/driven legend chip appears");
  ok((await text(p, "#hud .sub")).includes("driven"), "HUD splits walked and driven");
  const midDrive = offset(leave, -2700, 0), midKey = C.cellAt(...midDrive);
  ok(await p.evaluate(k => __wander.DRIVE.has(k), midKey), "a road cell is marked driven");
  pos = await walk(p, pos, offset(leave, -2500, 0), 20, 10000); // walk back along the road
  ok(await p.evaluate(k => __wander.WALK.has(k) && !__wander.DRIVE.has(k), midKey), "walking a driven road clears it fully");
  await p.click("#legend");
  ok(!(await p.locator("#legend").isVisible()), "legend chip dismissed");
  // the map pulls you somewhere new
  await hideToast(p);
  ok(await visible(p, "#chip"), "hint chip is shown");
  const chipTxt = await text(p, "#chip");
  ok(/\d+ \? places? near today's walk/.test(chipTxt), `hint chip text (${chipTxt})`);
  await p.click("#chip");
  ok(await visible(p, '.layer[data-id="hints"]'), "nearby hints list");
  const hintRow = await text(p, '.layer[data-id="hints"] [data-a=hint]');
  ok(/\? A (café|park|viewpoint|museum|landmark)/.test(hintRow) && /(north|south|east|west)/.test(hintRow) && /\d+ (m|km)/.test(hintRow), `hint row has kind, distance and direction (${hintRow.trim()})`);
  ok(!/Vohuman|Saras|Parvati/.test(await text(p, '.layer[data-id="hints"]')), "hint names stay hidden until you're close");
  await p.click('.layer[data-id="hints"] [data-a=hint]');
  ok((await text(p, "#hud")).includes("Heading to") && (await text(p, "#hud")).includes("within 150 m"), "guide HUD: heading to a ? place");
  ok((await text(p, "#chip")) === "Open in Google Maps", "guide offers Google Maps");
  ok(await p.locator('.leaflet-overlay-pane path[stroke="#2563eb"]').count() === 1, "dashed guide line drawn");
  await p.click("[data-a=guide-end]");
  ok(!(await text(p, "#hud")).includes("Heading to"), "guide closed");
  ok((await text(p, "#hud-streak")) === "1-day streak", "streak starts at 1");

  /* ===== Journey 3: find and collect ===== */
  J = "3 Find and collect";
  await setTime(p, at("2026-10-23T08:00:00+05:30"));
  const vp = [18.5240, 73.8620];
  pos = offset(HOME, 0, 400);
  await goTo(p, ...pos, 0);
  ok((await text(p, "#hud-streak")) === "1-day streak", "yesterday's streak still shows before any new cell today");
  pos = await walk(p, pos, offset(vp, -110, -40), 20, 10000);
  ok((await text(p, "#hud-streak")) === "2-day streak", "a new day with new cells extends the streak");
  ok(await st(p, () => !!__wander.S.places.n1001.found), "walking within 150 m finds the place");
  ok(/New place: Parvati Hill Viewpoint/.test(await text(p, "#toast")) && /Viewpoint · \d+ m/.test(await text(p, "#toast")), "new place toast with kind and distance");
  ok(await p.locator('.leaflet-marker-icon.pin-new[title="Parvati Hill Viewpoint"]').count() === 1, "found place shows as a pulsing pin");
  await hideToast(p);
  await p.click("#fab-locate");
  await p.click('.leaflet-marker-icon[title="Parvati Hill Viewpoint"]');
  ok((await text(p, '.layer[data-id="place"] .tag')) === "New place found", "place card opens from the pin");
  ok((await text(p, '.layer[data-id="place"]')).includes("Silhouette at the rail"), "place card lists photo ideas");
  await p.click('.layer[data-id="place"] [data-a=capture]');
  ok(await visible(p, "#cap"), "capture screen");
  ok((await text(p, "#cap .idea")).includes("Silhouette at the rail") && await p.locator("#cap svg.guide").count() === 1, "capture shows the idea and a pose guide");
  ok((await text(p, "#cap-count")) === "1 of 3", "capture counter 1 of 3");
  ok(await p.locator("#cap [data-a=collect][disabled]").count() === 1, "collect disabled before any photo");
  await p.setInputFiles("#cap-input", path.join(FIX, "photo.jpg"));
  await p.waitForFunction(() => document.querySelector("#cap-count") && document.querySelector("#cap-count").textContent === "2 of 3", null, { timeout: 5000 }).catch(() => {});
  ok((await text(p, "#cap-count")) === "2 of 3", "after one photo: 2 of 3");
  ok((await text(p, "#cap .ideas")).includes("✓ Silhouette at the rail") && (await text(p, "#cap .idea")).includes("The wide view"), "next idea is selected, first ticked");
  await p.setInputFiles("#cap-input", path.join(FIX, "photo2.jpg"));
  await p.waitForFunction(() => document.querySelectorAll("#cap .thumbs i").length === 2, null, { timeout: 5000 }).catch(() => {});
  ok(await p.locator("#cap .thumbs i").count() === 2, "two photo thumbnails");
  await p.click("#cap [data-a=collect]");
  ok((await text(p, ".stampc .tag")) === "Collected", "collected stamp");
  ok(/2 photos · 1 of 1 viewpoints in Pune/.test(await text(p, "#collected-sub")), `collected progress (${await text(p, "#collected-sub")})`);
  let pl = await st(p, () => __wander.S.places.n1001);
  ok(pl.got && pl.photos.length === 2, "place saved as collected with 2 photos");
  ok(await p.evaluate(async ids => { const r = await new Promise(res => { const q = indexedDB.open("wander"); q.onsuccess = () => { const t = q.result.transaction("photos").objectStore("photos").getAll(); t.onsuccess = () => res(t.result); }; }); return ids.every(id => r.some(x => x.id === id && x.mid && x.mid.size > 1000 && x.thumb.startsWith("data:image/jpeg"))); }, pl.photos), "photos stored (downsized copy + thumbnail)");
  await p.click("[data-a=see-collection]");
  ok(await visible(p, "#v-collection.on"), "Collection tab opens");
  ok((await text(p, "#coll-sum")) === "1 place in 1 city", "collection summary");
  ok(await p.locator("#v-collection .cats button").first().isVisible() && /1\/1Viewpoints/.test((await text(p, "#v-collection .cats")).replace(/\s/g, "")), "category progress 1/1 viewpoints");
  const tile = p.locator("#v-collection .tile.new");
  ok(await tile.count() === 1 && (await tile.textContent()).includes("Parvati Hill Viewpoint"), "new tile is highlighted");
  ok(/url\("data:image\/jpeg/.test(await tile.evaluate(e => getComputedStyle(e).backgroundImage)), "tile shows the photo");
  ok(await p.locator('#v-collection .tile.lock').count() >= 1, "undiscovered places show as locked tiles");
  await tile.click();
  ok((await text(p, "#detail-name")) === "Parvati Hill Viewpoint", "place detail");
  ok((await text(p, '.layer[data-id="detail"]')).includes("Collected 23 Oct 2026"), "detail shows when it was collected");
  ok(await p.locator("#detail-strip [data-a=photo]").count() === 2, "detail shows both photos");
  await p.fill("#note", "Sunset over the temple domes.");
  await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(300);
  ok((await st(p, () => __wander.S.places.n1001.note)) === "Sunset over the temple domes.", "note saved");
  ok(await p.locator('.leaflet-marker-icon.pin-got[title="Parvati Hill Viewpoint"]').count() === 1, "collected place shows as an orange dot");

  /* ===== Journey 4: a trip ===== */
  J = "4 A trip";
  await p.click("#fab-search");
  await p.fill("#search-q", "Lisbon"); await p.press("#search-q", "Enter");
  ok(await visible(p, '#search-res [data-a=city]'), "city search results");
  await p.click('#search-res [data-a=city]');
  ok((await text(p, '.layer[data-id="city"] .t1')) === "Lisbon, Portugal", "city sheet");
  await p.waitForFunction(() => /\d+ places? to find/.test((document.querySelector("#city-places") || {}).textContent || ""), null, { timeout: 6000 }).catch(() => {});
  ok(/\d+ km² · [\d,]+ cells · \d+ places to find/.test(await text(p, "#city-sub")), `city size, cells and places (${await text(p, "#city-sub")})`);
  const t0 = counters.tiles;
  await p.click("#dl-btn");
  await p.waitForSelector("#dl-done", { timeout: 30000 }).catch(() => {});
  const dl = await text(p, "#dl-done");
  ok(/Saved for offline · \d+ map tiles · \d+ places/.test(dl) && counters.tiles - t0 > 50, `offline download (${dl}; ${counters.tiles - t0} tiles fetched)`);
  ok(await p.evaluate(async () => (await (await caches.open("wander-tiles")).keys()).length) > 50, "tiles are in the offline cache");
  ok(await st(p, () => !!Object.values(__wander.S.offline).find(o => o.name === "Lisbon")), "city remembered as downloaded");
  await closeLayers(p);
  // fly to Lisbon the next morning
  await setTime(p, at("2026-10-24T08:00:00+05:30"));
  pos = [38.7150, -9.1330];
  await goTo(p, ...pos, 0);
  pos = await walk(p, pos, offset(pos, 20, 0), 20, 10000);
  ok(await st(p, () => !!__wander.S.tripId), "a trip starts by itself more than 50 km from home");
  ok(await visible(p, '.layer[data-id="welcome"]'), "arrival sheet");
  ok((await text(p, "#welcome-city")) === "Welcome to Lisbon", "welcome to the downloaded city");
  await p.click('.layer[data-id="welcome"] [data-a=close]');
  ok((await text(p, "#hud-city")) === "Lisbon" && (await text(p, "#hud-streak")) === "Trip day 1", "HUD switches to the trip city");
  pos = await walk(p, pos, offset([38.7166, -9.1310], -100, -20), 20, 10000);
  ok(await st(p, () => !!__wander.S.places.n2001.found), "found Miradouro da Graça");
  await hideToast(p);
  await p.evaluate(() => window.openPlace("n2001"));
  await p.click('.layer[data-id="place"] [data-a=capture]');
  await p.setInputFiles("#cap-input", path.join(FIX, "photo.jpg"));
  await p.waitForSelector("#cap [data-a=collect]:not([disabled])", { timeout: 5000 });
  await p.click("#cap [data-a=collect]");
  ok(/1 photo · 1 of 1 viewpoints in Lisbon/.test(await text(p, "#collected-sub")), "collected in Lisbon");
  await closeLayers(p);
  // evening recap
  await setTime(p, at("2026-10-24T20:45:00+05:30"));
  await goTo(p, ...offset(pos, 15, 0), 0);
  ok(/Day 1 in Lisbon: your recap/.test(await text(p, "#chip")), "evening recap chip");
  await p.click("#chip");
  ok((await text(p, '.layer[data-id="recap"] .tag')) === "Day 1 · Lisbon", "day recap");
  ok((await text(p, '.layer[data-id="recap"] h1')).includes("Miradouro da Graça"), "recap titled after the day's places");
  ok(/[\d.]+ km · 1 place · \+[\d.]+% of Lisbon/.test(await text(p, "#recap-sub")), `recap stats (${await text(p, "#recap-sub")})`);
  ok(await p.locator("#recap-map canvas").count() === 1, "recap map");
  await p.click('.layer[data-id="recap"] [data-a=star]');
  ok(await p.locator('.layer[data-id="recap"] .sel.star').count() === 1, "starred a favourite");
  await p.click('.layer[data-id="recap"] [data-a=recap-done]');
  ok(!(await text(p, "#chip")).includes("recap"), "recap chip goes away once done");
  // day 2
  await setTime(p, at("2026-10-25T10:00:00+05:30"));
  pos = [38.7160, -9.1338];
  await goTo(p, ...pos, 0);
  pos = await walk(p, pos, offset([38.7139, -9.1335], 80, 0), 20, 10000);
  ok(await st(p, () => !!__wander.S.places.n2002.found), "found Castelo de São Jorge on day 2");
  await hideToast(p);
  await p.evaluate(() => window.openPlace("n2002"));
  await p.click('.layer[data-id="place"] [data-a=capture]');
  await p.setInputFiles("#cap-input", path.join(FIX, "photo2.jpg"));
  await p.waitForSelector("#cap [data-a=collect]:not([disabled])", { timeout: 5000 });
  await p.click("#cap [data-a=collect]");
  await closeLayers(p);
  // home again
  await setTime(p, at("2026-10-26T12:00:00+05:30"));
  await goTo(p, ...HOME, 0);
  let trip = await st(p, () => __wander.S.trips[0]);
  ok(trip && trip.end && !(await st(p, () => __wander.S.tripId)), "trip ends when you're back home");
  await p.waitForFunction(() => /Lisbon<\/b> memory lane is ready/.test((document.getElementById("toast") || {}).innerHTML || ""), null, { timeout: 3000 }).catch(() => {});
  ok((await text(p, "#toast")).includes("Lisbon memory lane is ready"), "memory lane ready toast");
  ok(await p.locator('#nav [data-tab="trips"] .dot').count() === 1, "Trips tab shows a dot");
  await p.click("#toast-act");
  ok(/^Lisbon, Oct 2026$/.test((await text(p, '.layer[data-id="trip"] h1')).trim()), "memory lane opens");
  ok(/3 days · [\d.]+ km · 2 new places · \+[\d.]+%/.test(await text(p, "#trip-sub")), `memory lane stats (${await text(p, "#trip-sub")})`);
  ok((await text(p, '.layer[data-id="trip"]')).includes("Day 2 · Castelo de São Jorge"), "days listed with their places");
  ok((await text(p, '.layer[data-id="trip"] [data-a=highlights]')).includes("1 starred"), "highlights button counts stars");
  await p.click('.layer[data-id="trip"] [data-a=highlights]');
  ok(await p.locator("#hl-grid .tile .sel").count() === 1, "starred photo preselected");
  await p.click('#hl-grid [data-a=hl-pick]:not([aria-pressed="true"])');
  ok((await p.locator("#hl-grid .sel").allTextContents()).join(",") === "1,2", "picked in order 1, 2");
  await p.click("[data-a=hl-make]");
  await p.waitForSelector("#card-img", { timeout: 15000 }).catch(() => {});
  let sz = await p.evaluate(() => { const i = document.querySelector("#card-img"); return i && [i.naturalWidth, i.naturalHeight]; });
  ok(sz && sz[0] === 1080 && sz[1] === 1920, "highlights card is a 1080x1920 image");
  ok((await st(p, () => __wander.CARD.kind)) === "highlights" && (await st(p, () => __wander.S.trips[0].hl.length)) === 2, "highlights saved on the trip");
  await p.screenshot({ path: path.join(OUT, "j4-highlights.png") });

  /* ===== Journey 5: look back ===== */
  J = "5 Look back";
  await tab(p, "trips");
  ok((await text(p, "#v-trips")).includes("1 trip · 1 city"), "Trips summary");
  ok(/Lisbon\s*Oct 2026 · 3 days · \+/.test(await text(p, "#v-trips [data-a=trip]")), "trip row");
  ok(await p.locator('#nav [data-tab="trips"] .dot').count() === 0, "dot cleared after viewing the memory lane");
  await p.click("#v-trips [data-a=trip]");
  ok(await visible(p, '.layer[data-id="trip"]'), "memory lane from Trips");
  ok(await p.locator('.layer[data-id="trip"] .strip [data-a=photo]').count() === 2, "memory lane shows the trip photos");
  await tab(p, "collection");
  ok((await text(p, "#coll-sum")) === "3 places in 2 cities", "Collection across cities");
  await p.click('#v-collection [data-a=coll-city][data-city="Lisbon"]');
  ok(await p.locator("#v-collection [data-a=detail]").count() === 2 && !(await text(p, "#v-collection")).includes("Parvati"), "filter by city");
  await p.click('#v-collection [data-a=coll-city][data-city=""]');
  await tab(p, "me");
  const stats = (await p.locator("#me-stats .stat").allTextContents()).map(s => s.trim());
  ok(stats[0].startsWith("2") && stats[0].includes("cities") && stats[1].startsWith("2") && stats[2].startsWith("3"), `Me: cities, countries, places (${stats.slice(0, 3).join(" | ")})`);
  ok(/km²/.test(stats[3]) && /longest streak/.test(stats[4]) && /km/.test(stats[5]), "Me: area, streak, km on foot");
  ok(await p.locator("#me-map canvas").count() === 1, "Me map drawn");
  await p.click("[data-a=share-year]");
  await p.waitForSelector("#card-img", { timeout: 15000 }).catch(() => {});
  ok((await st(p, () => __wander.CARD && __wander.CARD.kind)) === "year" && (await p.locator("#card-img").count()) === 1, "Share my year card");

  /* ===== Journey 6: share and compare ===== */
  J = "6 Share and compare";
  await tab(p, "map");
  await p.click("#fab-share");
  await p.waitForSelector("#card-img", { timeout: 15000 }).catch(() => {});
  ok((await st(p, () => __wander.CARD.kind)) === "city", "map share opens the city card");
  const [png] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }).catch(() => null), p.click("[data-a=share-to][data-k=save]")]);
  const pngBuf = png ? fs.readFileSync(await png.path()) : Buffer.alloc(0);
  const dim = pngSize(pngBuf);
  ok(dim && dim[0] === 1080 && dim[1] === 1920, "Save downloads the card as a 1080x1920 PNG");
  if (png) fs.writeFileSync(path.join(OUT, "j6-card.png"), pngBuf);
  await p.click("[data-a=compare-link]");
  ok(await visible(p, '.layer[data-id="name"]'), "asks for your name before the first compare link");
  await p.fill("#name-in", "Raj"); await p.press("#name-in", "Enter");
  await p.waitForSelector("#link-text", { timeout: 8000 }).catch(() => {});
  const link = (await text(p, "#link-text")).trim();
  ok(link.startsWith("https://rj8228.github.io/Wander/c#A"), "compare link points at the web page with a compressed fragment");
  const dec = await C.unpackCompare(link).catch(() => null);
  ok(dec && dec.meta.n === "Raj" && dec.meta.c === "Pune" && dec.cells.length > 50, `link round-trips (${dec ? dec.cells.length : 0} cells, ${link.length} chars)`);
  const homeCells = dec ? dec.cells.filter(k => { const ll = C.cellLatLng(k); return C.dist(ll[0], ll[1], HOME[0], HOME[1]) < 250; }) : [1];
  ok(homeCells.length === 0, "no cells from the Home quiet place in the link");
  const mine = await st(p, () => __wander.WALK.size + __wander.DRIVE.size);
  ok(dec && dec.cells.length < mine, "link holds only the city's cells minus quiet places");
  await closeLayers(p);
  // a friend with the app opens the link
  const f = await newPage(b, { start: offset(HOME, -800, 300) });
  await setTime(f, at("2026-10-26T13:00:00+05:30"));
  await f.goto(U); await onboard(f);
  await walk(f, offset(HOME, -800, 300), offset(HOME, -800, 900), 25, 12000);
  await f.goto(U + "#c=" + link.split("#")[1]);
  await f.waitForFunction(() => __wander.FRIEND, null, { timeout: 6000 }).catch(() => {});
  ok((await f.evaluate(() => __wander.FRIEND && __wander.FRIEND.cells.size)) === dec.cells.length, "friend's app loads Raj's cells");
  ok(/You [\d.]+%/.test(await text(f, "#cmp-me")) && /Raj [\d.]+%/.test(await text(f, "#cmp-them")), `compare HUD shows both (${await text(f, "#cmp-me")} / ${await text(f, "#cmp-them")})`);
  ok(/Only you: [\d,]+ cells/.test(await text(f, "#cmp-onlyme")) && /Only Raj: [\d,]+ cells/.test(await text(f, "#cmp-onlythem")), "only-you / only-them counts");
  ok((await text(f, "#chip")) === "Send yours back ›", "send yours back chip");
  await f.click("#chip");
  ok(await visible(f, '.layer[data-id="name"]'), "friend is asked for a name before sending back");
  await f.fill("#name-in", "Priya"); await f.press("#name-in", "Enter");
  await f.waitForSelector("#link-text", { timeout: 8000 }).catch(() => {});
  const back = await C.unpackCompare((await text(f, "#link-text")).trim()).catch(() => null);
  ok(back && back.meta.n === "Priya" && back.meta.c === "Pune", "friend's link back covers the same city");
  await f.screenshot({ path: path.join(OUT, "j6-compare.png") });
  ok(!f.errors.length, "no errors in the friend's app: " + f.errors.join(" | "));
  await f.context().close();
  // no app: the web page
  const w = await newPage(b);
  await w.goto(U + "c/#" + link.split("#")[1]);
  await w.waitForSelector("body[data-ready]", { timeout: 6000 }).catch(() => {});
  ok(/^Raj uncovered [\d.]+% of Pune$/.test((await text(w, "#title")).trim()), `web fallback headline (${await text(w, "#title")})`);
  ok((await w.getAttribute("#apk", "href")).endsWith("/releases/download/latest/Wander.apk"), "web page offers the APK");
  ok((await w.getAttribute("#web", "href")) === "../#c=" + link.split("#")[1], "web page links to the browser version with the same map");
  ok(await w.evaluate(() => { const cv = document.querySelector(".fog"); return !!cv && cv.width > 0; }), "web page draws the fog map");
  await w.screenshot({ path: path.join(OUT, "j6-web.png") });
  await w.goto(U + "c/#Bnot-a-link"); await w.reload(); await w.waitForTimeout(300);
  ok((await text(w, "#title")).includes("broken"), "broken links get a friendly message");
  await w.context().close();
  // paste a link inside the app
  await tab(p, "me");
  await p.fill("#cmp-paste", link); await p.click("[data-a=compare-paste]");
  await p.waitForFunction(() => __wander.FRIEND, null, { timeout: 5000 }).catch(() => {});
  ok(await p.evaluate(() => !!__wander.FRIEND) && (await text(p, "#cmp-them")).startsWith("Raj"), "pasting a link in Me opens compare");
  await p.click("[data-a=compare-end]");
  ok(!(await p.evaluate(() => __wander.FRIEND)), "compare closes");

  /* ===== Journey 7: control and backup ===== */
  J = "7 Control and backup";
  await closeLayers(p); await hideToast(p);
  pos = offset(HOME, -600, -600);
  await goTo(p, ...pos, 60000);
  await p.click("#pill");
  ok((await text(p, '.layer[data-id="pause"]')).includes("Until tomorrow"), "pause sheet");
  await p.click('[data-a=pause][data-k=tomorrow]');
  ok((await text(p, "#pill")).includes("Paused until tomorrow") && await p.locator("#pill.off").count() === 1, "pill shows paused");
  const pausedAt = await W(p);
  pos = await walk(p, pos, offset(pos, 0, -300), 20, 10000);
  const afterPause = await W(p);
  ok(afterPause.walk === pausedAt.walk && afterPause.drive === pausedAt.drive, "nothing is recorded while paused");
  await p.click("#pill");
  await p.click("[data-a=resume]");
  ok(!(await text(p, "#pill")).includes("Paused"), "resumed");
  pos = await walk(p, pos, offset(pos, 0, -300), 20, 10000);
  ok((await W(p)).walk > afterPause.walk, "recording again after resume");
  await tab(p, "me");
  await p.click("[data-a=settings]");
  ok(await visible(p, '.layer[data-id="settings"]'), "settings");
  await p.click("[data-a=theme-pick]");
  await p.click('[data-a=theme][data-k=night]');
  ok((await p.getAttribute("html", "data-theme")) === "night", "Night explorer theme applied");
  await p.reload(); await p.waitForTimeout(300);
  ok((await p.getAttribute("html", "data-theme")) === "night", "theme persists");
  await p.screenshot({ path: path.join(OUT, "j7-night.png") });
  await tab(p, "me"); await p.click("[data-a=settings]"); await p.click("[data-a=theme-pick]"); await p.click('[data-a=theme][data-k=atlas]');
  ok((await p.getAttribute("html", "data-theme")) === "atlas", "Explorer's atlas theme");
  await p.click('[data-a=theme][data-k=day]');
  ok((await p.getAttribute("html", "data-theme")) === null, "back to Daylight");
  await closeLayers(p);
  await tab(p, "me"); await p.click("[data-a=settings]"); await p.click("[data-a=quiet-settings]");
  ok((await text(p, '.layer[data-id="quietset"]')).includes("Home") && (await text(p, '.layer[data-id="quietset"]')).includes("Office"), "quiet places list");
  await p.click('.layer[data-id="quietset"] [data-a=quiet-edit] >> nth=1');
  await p.click('[data-a=q-radius][data-r="400"]'); await p.fill("#q-name", "Studio"); await p.click("[data-a=q-save]");
  q = await st(p, () => __wander.S.quiet);
  ok(q[1].name === "Studio" && q[1].r === 400, "quiet place renamed and resized");
  await p.click('.layer[data-id="quietset"] [data-a=quiet-edit] >> nth=1'); await p.click("[data-a=q-del]");
  ok((await st(p, () => __wander.S.quiet.length)) === 1, "quiet place removed");
  await closeLayers(p);
  await tab(p, "me"); await p.click("[data-a=settings]"); await p.click("[data-a=backup]");
  const snap = await st(p, () => ({ walk: __wander.WALK.size, drive: __wander.DRIVE.size, got: Object.values(__wander.S.places).filter(x => x.got).length, trips: __wander.S.trips.length, photos: Object.keys(__wander.S.photos).length, note: __wander.S.places.n1001.note }));
  const [bk] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }).catch(() => null), p.click("[data-a=export]")]);
  const bkPath = path.join(OUT, "backup.json");
  if (bk) await bk.saveAs(bkPath);
  const bj = bk ? JSON.parse(fs.readFileSync(bkPath, "utf8")) : {};
  ok(bk && /^wander-backup-2026-10-\d\d\.json$/.test(bk.suggestedFilename()), "backup file name");
  ok(bj.app === "wander" && bj.state && bj.state.cells && bj.photos.length === snap.photos && bj.photos.every(x => x.thumb.startsWith("data:image")), "backup holds state and photo thumbnails");
  await closeLayers(p);
  await tab(p, "me"); await p.click("[data-a=settings]"); await p.click("[data-a=delete-ask]");
  await p.click("[data-a=delete-go]");
  await p.waitForSelector(".onb", { timeout: 6000 }).catch(() => {});
  ok(await p.locator(".onb").count() === 1 && (await W(p)).walk === 0, "delete all: back to the intro with an empty map");
  ok(await p.evaluate(() => localStorage.getItem("wander-v1") === null || !JSON.parse(localStorage.getItem("wander-v1")).firstFix), "nothing left in storage");
  await p.setInputFiles('.onb input[data-file=restore]', bkPath);
  ok(await visible(p, '.layer[data-id="restoreask"]'), "restore asks to confirm");
  ok(/\d[\d,]* cells, 3 collected places, 1 trips/.test(await text(p, '.layer[data-id="restoreask"]')), "restore summary");
  await p.click("[data-a=restore-go]");
  await p.waitForFunction(() => window.__wander && __wander.S.firstFix, null, { timeout: 8000 }).catch(() => {});
  const rs = await st(p, () => ({ walk: __wander.WALK.size, drive: __wander.DRIVE.size, got: Object.values(__wander.S.places).filter(x => x.got).length, trips: __wander.S.trips.length, photos: Object.keys(__wander.S.photos).length, note: __wander.S.places.n1001.note }));
  ok(JSON.stringify(rs) === JSON.stringify(snap), `restore brings everything back (${JSON.stringify(rs)})`);
  await tab(p, "collection");
  ok(/url\("data:image\/jpeg/.test(await p.locator("#v-collection [data-a=detail]").first().evaluate(e => getComputedStyle(e).backgroundImage)), "restored photos show in the collection");
  ok(!p.errors.length, "no page errors: " + p.errors.join(" | "));
  await p.screenshot({ path: path.join(OUT, "j7-restored.png") });
  await p.context().close();

  /* ===== Android bridge (stubbed WanderNative) ===== */
  J = "Android bridge";
  const stub = () => {
    const log = window.__nlog = [];
    const st = { fine: false, coarse: false, background: false, notify: false, sdk: 34 };
    window.__nq = []; window.__launch = null; let paused = 0;
    window.WanderNative = {
      permissions: () => JSON.stringify(st),
      requestPermission: k => { log.push(["requestPermission", k]); setTimeout(() => { if (k === "location") st.fine = st.coarse = true; if (k === "background") st.background = true; if (k === "notifications") st.notify = true; window.wanderOnPermission && window.wanderOnPermission(); }, 30); return true; },
      startTracking: m => log.push(["startTracking", m]),
      takePoints: () => JSON.stringify(window.__nq.splice(0)),
      status: () => JSON.stringify({ running: true, mode: "active", pausedUntil: paused, perms: st, last: null }),
      setQuietPlaces: j => log.push(["setQuietPlaces", JSON.parse(j)]),
      setNearbyPlaces: j => log.push(["setNearbyPlaces", JSON.parse(j)]),
      setKnownCells: j => log.push(["setKnownCells", JSON.parse(j).length]),
      setStatus: j => log.push(["setStatus", JSON.parse(j)]),
      pause: v => { paused = Number(v); log.push(["pause", Number(v)]); },
      share: t => log.push(["share", t]),
      shareImage: (b, t, k) => log.push(["shareImage", b.length, t, k, b.slice(0, 12)]),
      saveImage: (b, n) => log.push(["saveImage", b.length, n]),
      saveFile: (n, t) => log.push(["saveFile", n, t.length]),
      takeLaunch: () => { const l = window.__launch; window.__launch = null; return JSON.stringify(l); },
      takeCaptured: () => "[]", setTheme: d => log.push(["setTheme", d]), openUrl: u => log.push(["openUrl", u]), openAppSettings: () => log.push(["openAppSettings"]), reset: () => log.push(["reset"])
    };
  };
  const a = await newPage(b, { init: stub });
  await setTime(a, at("2026-10-27T09:00:00+05:30"));
  await a.goto(U);
  const nlog = () => a.evaluate(() => window.__nlog);
  const has = async (name, pred = () => true) => (await nlog()).some(e => e[0] === name && pred(e));
  let nt = T;
  const feed = async pts => { await a.evaluate(q => { window.__nq.push(...q); window.wanderLaunch(); }, pts.map(x => [nt += 10000, x[0], x[1], 6, x[2] == null ? -1 : x[2]])); await a.clock.setFixedTime(nt); };
  await a.click("[data-a=intro-go]"); await a.click("[data-a=loc-continue]");
  await a.waitForTimeout(200);
  ok(await has("requestPermission", e => e[1] === "location"), "asks Android for location");
  ok(await has("startTracking", e => e[1] === "smart"), "starts the foreground location service");
  ok(await has("requestPermission", e => e[1] === "notifications"), "asks for notifications on Android 13+");
  await feed([[...HOME]]);
  ok((await a.evaluate(() => __wander.WALK.size)) >= 5 && /You are here/.test(await text(a, "#toast")), "points from the service uncover the map");
  const route = []; for (let i = 1; i <= 50; i++) route.push([...offset(HOME, i * 15, i * 15), 1.4]);
  await feed(route);
  ok(await visible(a, '.layer[data-id="firstwalk"]'), "first-walk ask after a walk recorded by the service");
  await a.click("[data-a=bg-allow]");
  ok((await text(a, ".onb")).includes("Allow all the time"), "explains Allow all the time");
  await a.click("[data-a=bg-settings]");
  await a.waitForTimeout(150);
  ok(await has("requestPermission", e => e[1] === "background"), "requests background location only after the first walk");
  ok(await visible(a, '.layer[data-id="quiet"]'), "then quiet places");
  await a.click("[data-a=qd-save]");
  ok(await has("setQuietPlaces", e => e[1].length === 1 && e[1][0].name === "Home" && e[1][0].r === 250), "quiet places pushed to the service");
  const drive = []; for (let i = 1; i <= 8; i++) drive.push([...offset(HOME, 1000 + i * 200, 1000), 20]);
  await feed(drive);
  ok((await a.evaluate(() => __wander.DRIVE.size)) > 5, "fast points from the service count as driven");
  await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await a.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "hidden", { value: false, configurable: true }); });
  ok(await has("setKnownCells", e => e[1] > 10), "known cells pushed for the notification counter");
  ok(await has("setNearbyPlaces", e => e[1].length > 0 && e[1].every(x => x.id && x.name && x.lat)), "nearby unvisited places pushed for proximity alerts");
  ok(await has("setStatus", e => e[1].streak >= 1 && e[1].home && e[1].notif.streak), "streak and home pushed for reminders");
  await a.click("#pill"); await a.click('[data-a=pause][data-k=hour]');
  ok(await has("pause", e => e[1] > nt), "pause is sent to the service");
  ok((await text(a, "#pill")).includes("Paused until"), "pill paused (mirrors the service)");
  await a.click("#pill"); await a.click("[data-a=resume]");
  ok(await has("pause", e => e[1] === 0), "resume is sent to the service");
  await a.click("#fab-share");
  await a.waitForSelector("#card-img", { timeout: 15000 }).catch(() => {});
  await a.click("[data-a=share-to][data-k=whatsapp]");
  ok(await has("shareImage", e => e[1] > 10000 && e[3] === "whatsapp" && e[4] === "iVBORw0KGgoA"), "card goes to the native share sheet as PNG");
  await a.click("[data-a=share-to][data-k=save]");
  ok(await has("saveImage", e => /\.png$/.test(e[2])), "Save puts the card in the gallery");
  await a.click("[data-a=compare-link]");
  await a.fill("#name-in", "Raj"); await a.press("#name-in", "Enter");
  await a.waitForTimeout(300);
  const shared = (await nlog()).find(e => e[0] === "share");
  ok(shared && /Compare your fog maps: https:\/\/rj8228\.github\.io\/Wander\/c#A/.test(shared[1]), "compare link goes to the native share sheet");
  await closeLayers(a);
  await a.evaluate(l => { window.__launch = { link: l }; window.wanderLaunch(); }, link.replace("https://rj8228.github.io/Wander/c#", "wander://c?d="));
  await a.waitForFunction(() => __wander.FRIEND, null, { timeout: 5000 }).catch(() => {});
  ok(await a.evaluate(() => !!__wander.FRIEND), "a wander:// link from the web page opens compare in the app");
  await a.click("[data-a=compare-end]");
  const pid = await a.evaluate(() => Object.keys(__wander.S.places)[0]);
  await a.evaluate(id => { window.__launch = { place: id }; window.wanderLaunch(); }, pid);
  ok(await visible(a, '.layer[data-id="place"]'), "tapping a new-place notification opens the place card");
  await closeLayers(a);
  await tab(a, "me"); await a.click("[data-a=settings]"); await a.click("[data-a=backup]"); await a.click("[data-a=export]");
  ok(await has("saveFile", e => /^wander-backup-.*\.json$/.test(e[1]) && e[2] > 100), "backup saved through the bridge (Downloads)");
  ok(await a.evaluate(() => window.wanderBack() === "closed") && await a.evaluate(() => window.wanderBack() === "closed"), "Android back closes sheets first");
  ok(!a.errors.length, "no page errors: " + a.errors.join(" | "));
  await a.context().close();

  await b.close();
  console.log("\nJourney                  pass  fail");
  for (const [k, v] of Object.entries(results)) console.log(k.padEnd(24), String(v.pass).padStart(4), String(v.fail).padStart(5));
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
