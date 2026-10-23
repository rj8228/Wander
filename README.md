# Wander

The map starts covered in fog. Walking, driving and trips uncover it, hex by hex. Find nearby places (viewpoints, cafés, parks…), walk close, take guided photos and collect them. Trips to new cities get an evening recap and a memory lane. Share cards and compare links let friends compare fog maps without any server.

- **Android app:** download `Wander.apk` from the [latest release](https://github.com/rj8228/Wander/releases/tag/latest). It tracks with the screen off (with an ongoing notification you can pause from).
- **Web version:** https://rj8228.github.io/Wander/ (uncovers only while the page is open). Compare links open at https://rj8228.github.io/Wander/c#…

Everything stays on the phone. Backups are JSON files.

## How it's built

- `index.html`, `core.js` (hex grid, cell codec, compare links), `app.js` (state, tracking pipeline, places, trips, map), `cards.js` (share images), `ui.js` (screens). `version.js` is the single version source: the offline cache and the Android build follow it.
- Map: Leaflet (bundled in `vendor/`) with OpenStreetMap tiles; places from OpenStreetMap via Overpass; cities via Nominatim.
- Grid: pointy-top hexagons on the Web-Mercator plane, 55 m circumradius (95 m across at the equator, ~89 m in Mumbai, ~74 m in Lisbon).
- `android/` wraps the same files in a WebView and adds `TrackingService` (foreground location), notifications, the camera and the share sheet. GitHub Actions runs the tests and builds a signed APK on every push. The signing key is never in this repo; CI writes it from secrets.
- Tests: `python3 -m http.server 8788 &` then `node tests/e2e.js` (Playwright; all 7 journeys, offline fixtures).
