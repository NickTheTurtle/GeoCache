import { json, error } from '@sveltejs/kit';
import { checkPassword } from '$lib/server/config.js';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body.password)) throw error(401, 'Bad password');
  return json({ ok: true });
}
