import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

export function GET({ params }) {
  const g = db.getGroupByToken(params.token);
  if (!g) throw error(404, 'Crew not found');
  return json({ id: g.id, name: g.name, token: g.token });
}
