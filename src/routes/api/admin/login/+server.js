import { json, error } from '@sveltejs/kit';
import { ADMIN_PASSWORD } from '$lib/server/config.js';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  if ((body.password || '') !== ADMIN_PASSWORD) throw error(401, 'Bad password');
  return json({ ok: true });
}
