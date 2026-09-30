import { json, error } from '@sveltejs/kit';
import { checkPassword, readBody } from '$lib/server/config.js';

export async function POST({ request }) {
  const body = await readBody(request);
  if (!checkPassword(body.password)) throw error(401, 'Bad password');
  return json({ ok: true });
}
