/* Wander share cards and mini maps, drawn on canvas so they work offline and export as PNG. */
"use strict";

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function keysBounds(sets) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
  for (const s of sets) if (s) for (const k of s) { const c = C.cellXY(k); x1 = Math.min(x1, c[0]); x2 = Math.max(x2, c[0]); y1 = Math.min(y1, c[1]); y2 = Math.max(y2, c[1]); n++; }
  return n ? [x1, y1, x2, y2] : null;
}
const boxMerc = b => [C.mx(b[1]), C.my(b[0]), C.mx(b[3]), C.my(b[2])];
function withTimeout(p, ms) { return Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]); }
async function drawTiles(ctx, X, Y, W, H, k, ox, oy) {
  const z = Math.max(2, Math.min(18, Math.floor(Math.log2(k * 2 * C.PI_R / 256))));
  const f = k / (256 * Math.pow(2, z) / (2 * C.PI_R)), ts = 256 * f, n = Math.pow(2, z);
  const tx1 = Math.floor(ox / ts), tx2 = Math.floor((ox + W) / ts), ty1 = Math.max(0, Math.floor(oy / ts)), ty2 = Math.min(n - 1, Math.floor((oy + H) / ts));
  const jobs = [];
  for (let tx = tx1; tx <= tx2; tx++) for (let ty = ty1; ty <= ty2; ty++) {
    if (jobs.length > 64) break;
    const url = TILE_URL.replace("{z}", z).replace("{x}", ((tx % n) + n) % n).replace("{y}", ty);
    jobs.push(tileBlob(url).then(b => createImageBitmap(b)).then(img => ({ img, x: X + tx * ts - ox, y: Y + ty * ts - oy })).catch(() => null));
  }
  const got = (await withTimeout(Promise.all(jobs), 6000)) || [];
  const ok = got.filter(Boolean);
  if (!ok.length) return false;
  const th = themeColors();
  ctx.save(); if (th.tiles && th.tiles !== "none") ctx.filter = th.tiles;
  for (const t of ok) ctx.drawImage(t.img, t.x, t.y, ts + 0.5, ts + 0.5);
  ctx.restore();
  return true;
}
/** Draws a fog map into a rectangle. o: { box | fit sets, walk, drive, friend, hideQuiet, places, path, tiles, r } */
async function drawMapBox(ctx, X, Y, W, H, o = {}) {
  const th = themeColors();
  const sets = [o.walk || WALK, o.drive === undefined ? DRIVE : o.drive];
  const fit = o.box && o.fit !== false ? C.fitBox(sets, o.box, 1.4, 0.35) : o.box;
  let bx = fit ? boxMerc(fit) : keysBounds(sets);
  if (!bx) { const c = S.last || S.home || { lat: 20, lng: 0 }; bx = boxMerc(C.clampBox(null, c.lat, c.lng, 3)); }
  let bw = bx[2] - bx[0], bh = bx[3] - bx[1];
  const minSpan = 900; if (bw < minSpan) { bx[0] -= (minSpan - bw) / 2; bx[2] += (minSpan - bw) / 2; bw = minSpan; } if (bh < minSpan) { bx[1] -= (minSpan - bh) / 2; bx[3] += (minSpan - bh) / 2; bh = minSpan; }
  const padf = o.box ? 1 : 1.18;
  const k = Math.min(W / (bw * padf), H / (bh * padf));
  const cx = (bx[0] + bx[2]) / 2, cy = (bx[1] + bx[3]) / 2;
  const ox = (cx + C.PI_R) * k - W / 2, oy = (C.PI_R - cy) * k - H / 2;
  ctx.save();
  roundRect(ctx, X, Y, W, H, o.r == null ? 28 : o.r); ctx.clip();
  ctx.fillStyle = th.land; ctx.fillRect(X, Y, W, H);
  let tiles = false;
  if (o.tiles !== false) tiles = await drawTiles(ctx, X, Y, W, H, k, ox, oy);
  if (!tiles) { // a soft street-grid hint so the card never looks empty
    ctx.strokeStyle = "rgba(127,127,127,.12)"; ctx.lineWidth = 2;
    for (let i = -H; i < W + H; i += 46) { ctx.beginPath(); ctx.moveTo(X + i, Y); ctx.lineTo(X + i + H * 0.3, Y + H); ctx.stroke(); }
  }
  const off = document.createElement("canvas"); off.width = Math.ceil(W); off.height = Math.ceil(H);
  paintFog(off.getContext("2d"), W, H, k, ox, oy, { walk: o.walk, drive: o.drive, friend: o.friend === undefined ? null : o.friend, hideQuiet: o.hideQuiet });
  ctx.drawImage(off, X, Y);
  const px = (lat, lng) => [X + (C.mx(lng) + C.PI_R) * k - ox, Y + (C.PI_R - C.my(lat)) * k - oy];
  if (o.path && o.path.length > 1) {
    ctx.strokeStyle = th.accent; ctx.globalAlpha = 0.85; ctx.lineWidth = Math.max(2, W / 260); ctx.lineJoin = "round"; ctx.beginPath();
    o.path.forEach((p, i) => { const q = px(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (const p of o.places || []) {
    if (o.hideQuiet && nearQuiet(p.lat, p.lng, 60)) continue;
    const q = px(p.lat, p.lng), r = Math.max(4, W / 90);
    ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.fillStyle = th.accent; ctx.fill(); ctx.lineWidth = r / 2.5; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
  ctx.restore();
  return { tiles };
}
async function miniMap(el, o) {
  if (!el) return;
  const w = el.clientWidth || 320, h = el.clientHeight || 150, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement("canvas"); cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  el.innerHTML = ""; el.appendChild(cv);
  // draw at once without tiles, then again with the map underneath once tiles arrive (cached ones come back fast)
  await drawMapBox(ctx, 0, 0, w, h, Object.assign({ r: 0 }, o, { tiles: false }));
  const cv2 = document.createElement("canvas"); cv2.width = cv.width; cv2.height = cv.height;
  const c2 = cv2.getContext("2d"); c2.scale(dpr, dpr);
  const r = await drawMapBox(c2, 0, 0, w, h, Object.assign({ r: 0 }, o));
  if (r.tiles && cv.isConnected) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv2, 0, 0); }
}

/* ---------- photos for cards ---------- */
async function photoBitmap(id) {
  try {
    const p = await DB.get(id); if (!p) return null;
    if (p.mid) return await createImageBitmap(p.mid);
    if (p.thumb) { const b = await (await fetch(p.thumb)).blob(); return await createImageBitmap(b); }
  } catch (e) { /* missing */ }
  return null;
}
const GRADS = [["#f6b26b", "#e06c4f", "#5a3b6e"], ["#9fd3e8", "#4f9cc4", "#2d5e7c"], ["#f3e3b5", "#d9a066", "#8f5b3a"], ["#c6e3b0", "#7fb36a", "#3f6e3a"], ["#ffd27a", "#f08a5d", "#b83b5e"], ["#dfe7f2", "#9aa9c2", "#55627c"]];
function drawCover(ctx, img, x, y, w, h, r, i) {
  ctx.save(); roundRect(ctx, x, y, w, h, r); ctx.clip();
  if (img) {
    const s = Math.max(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  } else {
    const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h), c = GRADS[(i || 0) % 6];
    g.addColorStop(0, c[0]); g.addColorStop(0.5, c[1]); g.addColorStop(1, c[2]); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}
function hexLogo(ctx, x, y, s, color) {
  ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * s, y + Math.sin(a) * s); } ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}

/** Builds a 1080x1920 share card. kind: city | trip | highlights | year. Returns a canvas. */
async function makeCard(kind, o = {}) {
  try { await Promise.all([document.fonts.load("800 100px 'Bricolage Grotesque'"), document.fonts.load("700 30px Figtree"), document.fonts.load("600 30px Figtree")]); } catch (e) { /* system fonts */ }
  const th = themeColors(), W = 1080, H = 1920, P = 80;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  const D = "'Bricolage Grotesque', 'Avenir Next', system-ui, sans-serif", B = "Figtree, system-ui, sans-serif";
  let tag = "I uncovered", big = "", line = "", stats = [], photos = [], map = {}, grid = null;
  const placesIn = box => Object.values(S.places).filter(p => p.got && (!box || C.inBox(box, p.lat, p.lng)));
  if (kind === "trip" || kind === "highlights") {
    const t = o.trip, st = tripStats(t), ts = TS.get(t.id) || { all: new Set() };
    big = C.fmtPct(st.pct); line = "of " + t.city;
    stats = [[String(st.got), st.got === 1 ? "place" : "places"], [C.fmtKm(st.km).replace(" km", ""), "km on foot"], [String(st.days), st.days === 1 ? "day" : "days"]];
    map = { box: t.box, walk: new Set([...ts.all].filter(k => WALK.has(k))), drive: new Set([...ts.all].filter(k => DRIVE.has(k))), places: placesIn(t.box).filter(p => p.got >= t.start), hideQuiet: true };
    photos = (o.photos && o.photos.length ? o.photos : (t.hl && t.hl.length ? t.hl : Object.values(t.stars || {}).concat(tripPhotos(t)))).filter((v, i, a) => a.indexOf(v) === i);
    if (kind === "highlights") { const d0 = new Date(t.start); tag = "Highlights"; big = ""; line = t.city; grid = photos.slice(0, 10); tag += " · " + MONTHS[d0.getMonth()] + " " + d0.getFullYear(); }
  } else if (kind === "year") {
    const yr = new Date().getFullYear(), cities = new Set(S.trips.map(t => t.city)); if (S.homeCity) cities.add(S.homeCity.name);
    tag = "In " + yr + " I uncovered"; big = areaKm2() >= 10 ? Math.round(areaKm2()) + " km²" : areaKm2().toFixed(1) + " km²"; line = "of the world";
    const np = placesIn().length;
    stats = [[String(cities.size), cities.size === 1 ? "city" : "cities"], [String(np), np === 1 ? "place" : "places"], [C.fmtKm(S.stats.walk).replace(" km", ""), "km on foot"]];
    const c = ctxCity(); map = { box: S.homeCity ? S.homeCity.box : c && c.box, places: placesIn(), hideQuiet: true };
    photos = Object.entries(S.photos).sort((a, b) => b[1].t - a[1].t).map(([id]) => id);
  } else {
    const c = ctxCity(), st = c ? boxStats(c.box) : null;
    big = st ? C.fmtPct(st.p) : String(WALK.size + DRIVE.size); line = c ? "of " + c.name : "cells";
    const dl = Object.values(S.days).reduce((a, d) => a + d.w, 0);
    const np = placesIn(c && c.box).length;
    stats = [[String(np), np === 1 ? "place" : "places"], [C.fmtKm(dl).replace(" km", ""), "km on foot"], [String(streak()), "day streak"]];
    map = { box: c && c.box, places: placesIn(c && c.box), hideQuiet: true };
    photos = Object.entries(S.photos).filter(([, m]) => { const p = S.places[m.place]; return !c || (p && C.inBox(c.box, p.lat, p.lng)); }).sort((a, b) => b[1].t - a[1].t).map(([id]) => id);
  }
  // header
  ctx.fillStyle = th.muted; ctx.font = "700 34px " + B; ctx.textBaseline = "alphabetic";
  ctx.fillText(tag.toUpperCase().split("").join(String.fromCharCode(8202)), P, 150);
  let y = 150;
  if (big) { ctx.fillStyle = th.accent; ctx.font = "800 230px " + D; ctx.fillText(big, P - 8, y += 225); }
  if (line) { ctx.fillStyle = th.ink; ctx.font = "800 92px " + D; let l = line; while (ctx.measureText(l).width > W - 2 * P && l.length > 4) l = l.slice(0, -2) + "…"; ctx.fillText(l, P, y += 105); }
  y += 50;
  let attrib = false;
  if (grid) {
    const cols = grid.length > 4 ? 3 : 2, gap = 18, cw = (W - 2 * P - gap * (cols - 1)) / cols, rows = Math.ceil(Math.max(grid.length, 1) / cols);
    const ch = Math.min(cw * (grid.length <= 2 ? 1.25 : 1.15), (1340 - y) / rows - gap);
    for (let i = 0; i < Math.max(grid.length, 1); i++) {
      const img = grid[i] ? await photoBitmap(grid[i]) : null;
      drawCover(ctx, img, P + (i % cols) * (cw + gap), y + Math.floor(i / cols) * (ch + gap), cw, ch, 26, i);
      if (grid[i]) { ctx.fillStyle = th.accent; ctx.beginPath(); ctx.arc(P + (i % cols) * (cw + gap) + cw - 36, y + Math.floor(i / cols) * (ch + gap) + 36, 24, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "800 26px " + B; ctx.textAlign = "center"; ctx.fillText(String(i + 1), P + (i % cols) * (cw + gap) + cw - 36, y + Math.floor(i / cols) * (ch + gap) + 45); ctx.textAlign = "left"; }
    }
    y += rows * (ch + gap) + 20;
  } else {
    const mh = 1330 - y;
    const r = await drawMapBox(ctx, P, y, W - 2 * P, mh, Object.assign({ r: 40 }, map));
    attrib = r.tiles; y += mh + 40;
  }
  // stats
  const cw3 = (W - 2 * P) / 3;
  stats.forEach((s, i) => { ctx.fillStyle = th.ink; ctx.font = "800 76px " + D; ctx.fillText(s[0], P + i * cw3, y + 70); ctx.fillStyle = th.muted; ctx.font = "600 34px " + B; ctx.fillText(s[1], P + i * cw3, y + 118); });
  y += 160;
  if (grid && H - 150 - y > 240) { const r = await drawMapBox(ctx, P, y, W - 2 * P, H - 150 - y, Object.assign({ r: 32 }, map)); attrib = r.tiles; }
  if (!grid) {
    const ph = photos.slice(0, 3), n = 3, gap = 18, pw = (W - 2 * P - gap * (n - 1)) / n, phh = Math.min(240, H - 150 - y);
    if (phh > 80) for (let i = 0; i < n; i++) drawCover(ctx, ph[i] ? await photoBitmap(ph[i]) : null, P + i * (pw + gap), y, pw, phh, 24, i + (ph[i] ? 0 : 3));
  }
  // footer
  hexLogo(ctx, P + 22, H - 78, 22, th.accent);
  ctx.fillStyle = th.ink; ctx.font = "800 40px " + D; ctx.fillText("Wander", P + 58, H - 64);
  ctx.fillStyle = th.muted; ctx.font = "600 28px " + B; ctx.fillText("uncover your map", P + 230, H - 66);
  if (attrib) { ctx.font = "500 22px " + B; ctx.textAlign = "right"; ctx.fillText("Map © OpenStreetMap contributors", W - P, H - 30); ctx.textAlign = "left"; }
  return cv;
}
