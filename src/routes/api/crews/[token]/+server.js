import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

export function GET({ params }) {
  const c = db.getCrewByToken(params.token);
  if (!c) throw error(404, 'Crew not found');
  return json({ id: c.id, name: c.name, token: c.token });
}
