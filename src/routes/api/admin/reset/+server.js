import { json } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, readBody } from '$lib/server/config.js';

// Reset the game. keepZones=true clears only employees/claims/points.
export async function POST({ request, url }) {
  requireAdmin(request, url);
  const body = await readBody(request);
  const keepZones = body.keepZones !== false;
  db.resetGame({ keepZones });
  return json({ ok: true, keptZones: keepZones });
}
