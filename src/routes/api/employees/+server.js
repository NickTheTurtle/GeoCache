import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, isAdmin } from '$lib/server/config.js';

// Tokens are an employee's private sign-in secret ("personal link"), so only admins
// get them. Players see just id + name.
export function GET({ request, url }) {
  const admin = isAdmin(request, url);
  return json(
    db.listEmployees().map((c) => (admin ? { id: c.id, name: c.name, token: c.token } : { id: c.id, name: c.name }))
  );
}

// Employee creation is admin-only; players join via their personal link.
export async function POST({ request, url }) {
  requireAdmin(request, url);
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) throw error(400, 'Employee name is required.');
  if (name.length > 40) throw error(400, 'Name too long');
  const employee = db.createEmployee(name);
  return json(
    {
      id: employee.id,
      name: employee.name,
      token: employee.token,
      link: `${url.origin}/?g=${employee.token}`,
    },
    { status: 201 }
  );
}
