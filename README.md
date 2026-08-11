# 🧭 GeoCache SF

A GeoCaching game for you and your friends, bounded to San Francisco. Admins
draw zones on a map and hide a QR-coded object in each; groups race to find the
objects, scan the codes, and score points.

## Features

- **One-click registration** — each group gets a personal link (`/?g=<token>`)
  that identifies them so scans claim zones for them.
- **SF map** (Leaflet + OpenStreetMap) — every zone is a boundary; click to zoom
  in and read its hint.
- **QR claiming** — each zone has a unique QR code; scanning claims it (+1 point).
- **Leaderboard** — live ranking by points.
- **Admin page** — draw/edit zones, write hints, bulk import/export, and
  generate a QR code per zone.

## Run locally

```bash
npm install
npm run build
$env:ADMIN_PASSWORD="s3cret"   # optional; defaults to "changeme"
npm start                       # runs server.js, opens on http://localhost:3000
```

Admin is at `/admin`. For hot-reload dev use `npm run dev` (port 5173) — but the
QR camera scanner needs a secure context, so it only works from `npm start` or
localhost, not the dev server over the LAN.

Requires **Node.js ≥ 22.5** (uses built-in `node:sqlite` — no external database).

### HTTPS on your LAN (for phones)

Phones need HTTPS for the camera. Run `npm run gen-cert` once (needs OpenSSL,
bundled with Git for Windows) to create a self-signed cert in `certs/`. After
that, `npm start` serves HTTPS on 443 (and `PORT`) with HTTP→HTTPS redirect on
80. Generate QR codes afterward so they point at your LAN IP over HTTPS.

## Testing

```bash
npm test          # unit tests (node:test) for db/config/util
npm run test:e2e  # Playwright UI tests — run `npm run build` first
```

E2E tests (`e2e/`) drive locally-installed Microsoft Edge (no browser download)
against an isolated server on ports 8443/8080 with its own throwaway `DATA_DIR`,
so they never touch real game data. They cover the map, claim modal, admin
console, and mobile layout, and assert text legibility (contrast).

## How to play

1. **Admin** (`/admin`) draws each zone, adds a hint, saves, then **Download QR**
   and attaches it to the physical object.
2. **Players** open the site, create their group, and keep their personal link.
3. On finding an object, a group scans its QR code and taps **Claim** for a point.

## Bulk zones: import / export

The admin console can import/export zones as JSON — handy for generating a whole
map at once (e.g. with an AI assistant).

- **Export** downloads `geocache-zones.json` (a re-importable backup; hint images
  included as base64).
- **Import** loads a file. Tick **Replace existing zones** to swap the whole map;
  leave it unticked to append. Fresh QR secrets are minted, and each polygon must
  have 3+ points inside SF or the whole import is rejected.

Format (see [`zones.example.json`](./zones.example.json)):

```json
{
  "zones": [
    {
      "name": "Golden Gate Park — Windmill",
      "hint": "Look near the bench facing the **Dutch windmill**.",
      "polygon": [[37.7699, -122.5108], [37.7712, -122.5108], [37.7712, -122.5090]],
      "imageData": "data:image/png;base64,…  (optional)"
    }
  ]
}
```

`hint` supports markdown (`**bold**`, `_italic_`). A bare top-level array is also
accepted. To import over SSH:

```bash
curl -X POST https://<your-domain>/api/admin/zones/import \
  -H "x-admin-password: $ADMIN_PASSWORD" -H "Content-Type: application/json" \
  --data @zones.json
```

## Environment variables

| Variable          | Default    | Purpose                                 |
| ----------------- | ---------- | --------------------------------------- |
| `PORT`            | `3000`     | Port the server listens on.             |
| `ADMIN_PASSWORD`  | `changeme` | Admin page password. **Change this.**   |
| `DATA_DIR`        | `./data`   | Directory for the SQLite database file. |
| `PUBLIC_BASE_URL` | —          | Public URL encoded in QR codes.         |

## Deploying

The app is a standard Node service that needs **persistent disk** for the SQLite
database — so serverless hosts (Amplify, Lambda) won't work.

- **AWS EC2** (recommended): see [`deploy/README.md`](./deploy/README.md) for a
  one-command setup script (Node + Caddy + auto-HTTPS).
- **Render**: a `render.yaml` blueprint is included (needs a paid plan for the
  disk).
- **Others** (Railway, Fly.io): start command `node server.js`, attach a volume,
  point `DATA_DIR` at it, and set `ADMIN_PASSWORD`.

> ⚠️ Generate QR codes from the **deployed** URL so phones reach the public server.

## Project structure

```
server.js                 HTTPS/HTTP launcher wrapping the adapter-node build
scripts/gen-cert.js       Generates a self-signed TLS cert for LAN HTTPS
deploy/                   EC2 setup + update scripts
src/
  app.css                 Shared styles
  lib/
    server/db.js          SQLite schema and queries (node:sqlite)
    server/config.js      Admin auth, SF bounds, QR URL helpers
    leaflet.js            Client-only Leaflet + MapLibre loader
    util.js               Shared client helpers (zone styling, QR parsing)
  routes/
    +page.svelte          Main map, registration, leaderboard, scanner, claim
    claim/+page.js        Redirects old /claim?c= links to the main-page modal
    admin/+page.svelte    Zone drawing, import/export, QR generation
    api/                  SvelteKit server endpoints
render.yaml               Render deployment blueprint
```
