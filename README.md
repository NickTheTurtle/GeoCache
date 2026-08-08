# 🧭 GeoCache SF

A simple GeoCaching game for you and your friends, bounded to San Francisco.
Admins draw zones on a map, hide a physical object with a QR code in each zone,
and groups race to find objects and scan the QR codes to claim zones and score points.

## Features

- **Simple registration** — each group creates itself in one click and gets a
  personal link (`/?g=<token>`). Bookmark it; that link identifies your group so
  scans claim zones for you.
- **SF map** (Leaflet + OpenStreetMap) showing every zone as a boundary. Click a
  zone to zoom in and read its hint.
- **QR claiming** — every zone has a unique QR code that links to a claim page.
  The first group to scan it claims the zone (+1 point). Zones turn amber once
  claimed.
- **Leaderboard** — live ranking of every group by points.
- **Admin page** — draw/edit zones on the map, write hints, and generate &
  download a QR code per zone.

## Run locally

```bash
npm install
npm run build
# optional: set an admin password (defaults to "changeme")
# PowerShell:  $env:ADMIN_PASSWORD="s3cret"
npm start
```

`npm start` runs `server.js`, a small launcher around the SvelteKit
(adapter-node) build. Then open http://localhost:3000 (admin at
http://localhost:3000/admin).

For rapid development use `npm run dev` (Vite dev server with hot reload) and
open http://localhost:5173. Note: the in-app QR scanner needs a secure context,
so camera scanning only works from the built server over HTTPS or from
localhost, not the Vite dev server over the LAN.

### HTTPS on your LAN (for phones)

Phones need HTTPS to use the camera. Run `npm run gen-cert` once (needs OpenSSL,
included with Git for Windows) to create a self-signed cert in `certs/`. After
that, `npm start` serves HTTPS on port 443 (and `PORT`), with plain HTTP on 80
redirecting to HTTPS. Generate QR codes after this so they point at your
machine's LAN IP over HTTPS.

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite` module: no native
build step, no external database).

## Testing

```bash
npm test          # fast unit tests (node:test) for db/config/util helpers
npm run test:e2e  # end-to-end UI tests (Playwright) — build first
```

Unit tests live in `tests/` and run with the built-in Node test runner.

End-to-end tests live in `e2e/` and use [Playwright](https://playwright.dev)
driving the locally-installed **Microsoft Edge** (`channel: 'msedge'`, so no
browser download is needed). `playwright.config.js` boots an isolated instance
of the production server on ports **8443/8080** with its own throwaway
`DATA_DIR` (`e2e/.data`) and a fixed admin password, so E2E never touches your
real game data and can run alongside a dev server. `e2e/global-setup.js` seeds
crews and zones via the API before the suite runs.

The suite covers the main map, the QR-link claim modal (all states + edge
cases), old `/claim` redirects, the admin console, and mobile layout. It also
asserts real **text legibility** (compositing translucent backgrounds to catch
invisible / low-contrast text). Run `npm run build` before `npm run test:e2e`
so the server serves the current UI.

## How to play

1. **Admin** opens `/admin`, logs in, and for each hidden object:
   - clicks points on the map to draw the zone boundary,
   - adds a name and a hint,
   - saves, then **Download QR** and prints/attaches it to the physical object.
2. **Players** open the site, create their group, and keep their personal link.
3. When a group finds an object, they scan its QR code → the claim page opens →
   they tap **Claim** and score a point.

## Environment variables

| Variable         | Default            | Purpose                                          |
| ---------------- | ------------------ | ------------------------------------------------ |
| `PORT`           | `3000`             | Port the server listens on.                      |
| `ADMIN_PASSWORD` | `changeme`         | Password for the admin page. **Change this.**    |
| `DATA_DIR`       | `./data`           | Directory for the SQLite database file.          |

## Deploying to a cloud host

The app is a standard Node web service. It needs **persistent disk** for the
SQLite database (`DATA_DIR`), so pick a host/plan that offers one.

### Render (config included)

A `render.yaml` blueprint is provided. Push this repo to GitHub, create a new
**Blueprint** on Render pointing at it, then set `ADMIN_PASSWORD` when prompted.
It provisions a 1 GB disk mounted at `/var/data`.

### Railway / Fly.io / others

- Start command: `node server.js`
- Attach a volume and point `DATA_DIR` at its mount path (e.g. `/data`).
- Set `ADMIN_PASSWORD`.
- The host sets `PORT` automatically; the server honors it.

> ⚠️ Once deployed, generate QR codes from the **deployed** URL (do it in the
> admin page on the live site) so phones scanning them reach the public server.

## Project structure

```
server.js                 HTTPS/HTTP launcher wrapping the adapter-node build
svelte.config.js          SvelteKit config (adapter-node)
vite.config.js            Vite config
scripts/gen-cert.js       Generates a self-signed TLS cert for LAN HTTPS
src/
  app.html                HTML shell
  app.css                 Shared styles
  lib/
    server/db.js          SQLite schema and queries (node:sqlite)
    server/config.js      Admin auth, SF bounds, QR URL helpers
    mapstyle.js           MapLibre vector map style
    leaflet.js            Client-only Leaflet + MapLibre loader
    crew.js               Current-crew store (localStorage)
    util.js               Shared client helpers (zone styling, QR parsing)
  routes/
    +page.svelte          Main map, registration, leaderboard, scanner
    claim/+page.svelte    QR landing page that claims a zone
    admin/+page.svelte    Zone drawing + QR generation
    api/                  SvelteKit server endpoints (REST API)
render.yaml               Render deployment blueprint
Procfile                  Generic process definition
```
