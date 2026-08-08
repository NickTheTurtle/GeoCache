import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, isAdmin } from '$lib/server/config.js';

// Tokens are a crew's private sign-in secret ("personal link"), so only admins
// get them. Players see just id + name.
export function GET({ request, url }) {
  const admin = isAdmin(request, url);
  return json(
    db.listGroups().map((g) => (admin ? { id: g.id, name: g.name, token: g.token } : { id: g.id, name: g.name }))
  );
}

// Group creation is admin-only; players join via their personal link.
export async function POST({ request, url }) {
  requireAdmin(request, url);
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) throw error(400, 'Crew name is required');
  if (name.length > 40) throw error(400, 'Name too long');
  const group = db.createGroup(name);
  return json(
    {
      id: group.id,
      name: group.name,
      token: group.token,
      link: `${url.origin}/?g=${group.token}`,
    },
    { status: 201 }
  );
}
