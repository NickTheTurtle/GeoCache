import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Self-signed cert on the test server.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE = process.env.E2E_BASE || 'https://localhost:8443';
const ADMIN = process.env.E2E_ADMIN || 'e2e-secret-pw';
const H = { 'Content-Type': 'application/json', 'x-admin-password': ADMIN };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '.fixture.json');

// A few triangles well inside the SF bounds (valid zone polygons). Sized large
// enough (~0.006°, ~600m) to be comfortably clickable on the rendered map.
const tri = (lat, lng) => [
  [lat, lng],
  [lat + 0.006, lng],
  [lat + 0.006, lng + 0.006],
];

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${opts.method || 'GET'} ${pathname} -> ${res.status} ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/config`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server never became ready at ${BASE}`);
}

export default async function globalSetup() {
  await waitForServer();

  // Clean slate: drop crews, claims, and zones.
  await api('/api/admin/reset', { method: 'POST', headers: H, body: JSON.stringify({ keepZones: false }) });

  // Crews
  const fog = await api('/api/crews', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Fog Chasers' }) });
  const trolls = await api('/api/crews', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Bridge Trolls' }) });

  // Zones
  const alpha = await api('/api/admin/zones', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      name: 'Alpha Cache',
      hint: 'Look for the **red** bench near the *windmill*.',
      polygon: tri(37.769, -122.481),
    }),
  });
  const beta = await api('/api/admin/zones', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      name: 'Beta Cache',
      hint: 'Behind the fountain.',
      polygon: tri(37.772, -122.45),
    }),
  });

  // Pre-claim Beta for Fog Chasers so we can exercise the "already claimed" view
  // and a non-empty leaderboard.
  await api(`/api/admin/zones/${beta.id}/claim`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ crewId: fog.id }),
  });

  const fixture = {
    base: BASE,
    admin: ADMIN,
    crews: { fog, trolls },
    zones: { alpha, beta },
  };
  writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2));
  console.log('[e2e] seeded fixture:', {
    fog: fog.name,
    trolls: trolls.name,
    alpha: alpha.secret,
    beta: beta.secret,
  });
}
