/* Wander core: the hex grid, the compact cell codec, compare links and small geo helpers.
   Shared by the app, the compare web page (c/) and the tests. Android's Hex.kt mirrors the grid maths exactly.

   Grid: pointy-top hexagons laid on the Web-Mercator plane with a circumradius of 55 Mercator metres.
   On the ground a cell is 95 m across at the equator and 95 m x cos(latitude) elsewhere:
   about 89 m in Mumbai, 82 m in Delhi, 74 m in Lisbon, 59 m in London. One global grid, so friends' maps line up. */
(function (root) {
  "use strict";
  const R = 6378137, PI_R = Math.PI * R, HEX = 55, SQ3 = Math.sqrt(3), OFF = 524288, W = 1048576, D2R = Math.PI / 180;

  const clampLat = lat => Math.max(-85.05, Math.min(85.05, lat));
  const mx = lng => R * lng * D2R;
  const my = lat => R * Math.log(Math.tan(Math.PI / 4 + clampLat(lat) * D2R / 2));
  const lngOf = x => x / R / D2R;
  const latOf = y => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D2R;

  function axial(x, y) {
    const qf = (SQ3 / 3 * x - y / 3) / HEX, rf = (2 / 3 * y) / HEX, sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf); const s = Math.round(sf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    return [q, r];
  }
  const pack = (q, r) => (r + OFF) * W + (q + OFF);
  function unpack(k) { const rr = Math.floor(k / W); return [k - rr * W - OFF, rr - OFF]; }
  const centerXY = (q, r) => [HEX * SQ3 * (q + r / 2), HEX * 1.5 * r];
  const cellAt = (lat, lng) => { const a = axial(mx(lng), my(lat)); return pack(a[0], a[1]); };
  function cellXY(k) { const a = unpack(k); return centerXY(a[0], a[1]); }
  function cellLatLng(k) { const c = cellXY(k); return [latOf(c[1]), lngOf(c[0])]; }
  /** Ground area of one cell in m² at a latitude. */
  const cellArea = lat => 1.5 * SQ3 * HEX * HEX * Math.pow(Math.cos(lat * D2R), 2);

  /** Cells whose centre is within `m` ground metres of a point, always including the point's own cell. */
  function cellsNear(lat, lng, m, out) {
    out = out || [];
    const x = mx(lng), y = my(lat), rm = m / Math.cos(clampLat(lat) * D2R), rm2 = rm * rm;
    const a = axial(x, y); out.push(pack(a[0], a[1]));
    const rmin = Math.floor((y - rm) / (HEX * 1.5)), rmax = Math.ceil((y + rm) / (HEX * 1.5));
    for (let r = rmin; r <= rmax; r++) {
      const qmin = Math.floor((x - rm) / (HEX * SQ3) - r / 2), qmax = Math.ceil((x + rm) / (HEX * SQ3) - r / 2);
      for (let q = qmin; q <= qmax; q++) {
        const c = centerXY(q, r), dx = c[0] - x, dy = c[1] - y;
        if (dx * dx + dy * dy <= rm2 && !(q === a[0] && r === a[1])) out.push(pack(q, r));
      }
    }
    return out;
  }

  /** Every cell key inside a Mercator box, or null when there are more than `cap`. */
  function cellsInBox(x1, y1, x2, y2, cap) {
    const rmin = Math.floor(y1 / (HEX * 1.5)) - 1, rmax = Math.ceil(y2 / (HEX * 1.5)) + 1;
    const cols = Math.ceil((x2 - x1) / (HEX * SQ3)) + 3;
    if ((rmax - rmin + 1) * cols > cap) return null;
    const out = [];
    for (let r = rmin; r <= rmax; r++) {
      const qmin = Math.floor(x1 / (HEX * SQ3) - r / 2) - 1, qmax = Math.ceil(x2 / (HEX * SQ3) - r / 2) + 1;
      for (let q = qmin; q <= qmax; q++) out.push(pack(q, r));
    }
    return out;
  }

  /* ---------- geo helpers ---------- */
  function dist(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * D2R, dLng = (lng2 - lng1) * D2R;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371008 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearing(lat1, lng1, lat2, lng2) {
    const y = Math.sin((lng2 - lng1) * D2R) * Math.cos(lat2 * D2R);
    const x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lng2 - lng1) * D2R);
    return (Math.atan2(y, x) / D2R + 360) % 360;
  }
  const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const compass = deg => COMPASS[Math.round(deg / 45) % 8];
  const fmtDist = m => m < 950 ? Math.max(10, Math.round(m / 10) * 10) + " m" : (m < 9950 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + " km";
  const fmtKm = m => (m >= 99500 ? Math.round(m / 1000) : (m / 1000).toFixed(1)) + " km";
  const fmtPct = p => (p <= 0 ? "0" : p < 0.1 ? "0.1" : p < 10 ? (Math.round(p * 10) / 10).toString() : Math.round(p).toString()) + "%";

  /** A box [south, west, north, east] around a point, at most `km` on each side. */
  function clampBox(box, lat, lng, km) {
    const dLat = km / 2 / 111.32, dLng = km / 2 / (111.32 * Math.cos(lat * D2R));
    let [s, w, n, e] = box || [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
    s = Math.max(s, lat - dLat); n = Math.min(n, lat + dLat); w = Math.max(w, lng - dLng); e = Math.min(e, lng + dLng);
    if (n - s < 0.004) { s = lat - 0.01; n = lat + 0.01; }
    if (e - w < 0.004) { w = lng - 0.012; e = lng + 0.012; }
    return [s, w, n, e];
  }
  const boxAreaKm2 = b => dist(b[0], b[1], b[2], b[1]) * dist((b[0] + b[2]) / 2, b[1], (b[0] + b[2]) / 2, b[3]) / 1e6;
  /** How many cells cover a box (Mercator area / cell area). */
  const boxCells = b => Math.max(1, Math.round((mx(b[3]) - mx(b[1])) * (my(b[2]) - my(b[0])) / (1.5 * SQ3 * HEX * HEX)));
  const inBox = (b, lat, lng) => lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];
  /** A [s, w, n, e] box around cell keys (optionally only those inside `within`), padded, at least `minKm` across, clipped to `within`. */
  function fitBox(sets, within, minKm, pad) {
    let s = 90, w = 180, n = -90, e = -180, any = false;
    for (const set of sets) if (set) for (const k of set) {
      const ll = cellLatLng(k); if (within && !inBox(within, ll[0], ll[1])) continue;
      any = true; s = Math.min(s, ll[0]); n = Math.max(n, ll[0]); w = Math.min(w, ll[1]); e = Math.max(e, ll[1]);
    }
    if (!any) return within || null;
    const clat = (s + n) / 2, clng = (w + e) / 2, kx = 111.32 * Math.cos(clat * D2R);
    const hLat = Math.max((n - s) * (1 + (pad || 0.3)), (minKm || 1.2) / 111.32) / 2, hLng = Math.max((e - w) * (1 + (pad || 0.3)), (minKm || 1.2) / kx) / 2;
    let b = [clat - hLat, clng - hLng, clat + hLat, clng + hLng];
    if (within) b = [Math.max(b[0], within[0]), Math.max(b[1], within[1]), Math.min(b[2], within[2]), Math.min(b[3], within[3])];
    return b;
  }

  /* ---------- compact codec: sorted keys -> deltas -> LEB128 varints -> base64url ---------- */
  function varints(keys) {
    const a = Array.from(keys).sort((p, q) => p - q), out = [];
    let prev = 0;
    for (const k of a) { let v = k - prev; prev = k; while (v >= 128) { out.push((v % 128) + 128); v = Math.floor(v / 128); } out.push(v); }
    return out;
  }
  function unvarints(bytes, start, end) {
    const res = []; let prev = 0, v = 0, mul = 1;
    for (let i = start || 0, n = end == null ? bytes.length : end; i < n; i++) {
      const b = bytes[i]; v += (b & 127) * mul;
      if (b < 128) { prev += v; res.push(prev); v = 0; mul = 1; } else mul *= 128;
    }
    return res;
  }
  function b64url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray ? bytes.subarray(i, i + 0x8000) : bytes.slice(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64url(str) {
    const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const encodeCells = keys => b64url(new Uint8Array(varints(keys)));
  const decodeCells = str => str ? unvarints(unb64url(str)) : [];

  async function pipeBytes(bytes, stream) {
    const s = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const canZip = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

  /** Compare link payload: varint(json length) + json + cell varints, deflated, base64url. "A" = deflated, "B" = plain. */
  async function packCompare(meta, keys) {
    const json = new TextEncoder().encode(JSON.stringify(meta));
    const head = []; let n = json.length; while (n >= 128) { head.push((n % 128) + 128); n = Math.floor(n / 128); } head.push(n);
    const cells = varints(keys);
    const raw = new Uint8Array(head.length + json.length + cells.length);
    raw.set(head, 0); raw.set(json, head.length); raw.set(cells, head.length + json.length);
    if (canZip()) { try { return "A" + b64url(await pipeBytes(raw, new CompressionStream("deflate-raw"))); } catch (e) { /* fall through */ } }
    return "B" + b64url(raw);
  }
  async function unpackCompare(str) {
    str = String(str || "").trim();
    const m = str.match(/(?:[#?&]c=|[#?&]d=|#)([AB][A-Za-z0-9_-]+)\s*$/);
    if (m) str = m[1];
    if (!/^[AB][A-Za-z0-9_-]+$/.test(str)) throw new Error("Not a Wander compare link");
    let raw = unb64url(str.slice(1));
    if (str[0] === "A") raw = await pipeBytes(raw, new DecompressionStream("deflate-raw"));
    let len = 0, mul = 1, i = 0;
    for (; i < raw.length; i++) { const b = raw[i]; len += (b & 127) * mul; if (b < 128) { i++; break; } mul *= 128; }
    const meta = JSON.parse(new TextDecoder().decode(raw.subarray(i, i + len)));
    return { meta, cells: unvarints(raw, i + len) };
  }

  /* ---------- sun: today's sunset, for "golden hour in 40 min" ---------- */
  function sunset(date, lat, lng) {
    const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(2000, 0, 1, 12)) / 864e5) + 1;
    const n = day - lng / 360, M = (357.5291 + 0.98560028 * n) % 360, Mr = M * D2R;
    const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    const lam = ((M + C + 180 + 102.9372) % 360) * D2R;
    const Jt = 2451545 + n + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lam);
    const dec = Math.asin(Math.sin(lam) * Math.sin(23.44 * D2R));
    const cosw = (Math.sin(-0.83 * D2R) - Math.sin(lat * D2R) * Math.sin(dec)) / (Math.cos(lat * D2R) * Math.cos(dec));
    if (cosw < -1 || cosw > 1) return null;
    const Jset = Jt + Math.acos(cosw) / D2R / 360;
    return new Date((Jset - 2440587.5) * 864e5);
  }

  const api = { R, PI_R, HEX, SQ3, mx, my, lngOf, latOf, axial, pack, unpack, centerXY, cellAt, cellXY, cellLatLng, cellArea, cellsNear, cellsInBox,
    dist, bearing, compass, fmtDist, fmtKm, fmtPct, clampBox, boxAreaKm2, boxCells, inBox, fitBox,
    varints, unvarints, b64url, unb64url, encodeCells, decodeCells, packCompare, unpackCompare, sunset };
  if (typeof module === "object" && module.exports) module.exports = api; else root.WanderCore = api;
})(typeof self !== "undefined" ? self : this);
