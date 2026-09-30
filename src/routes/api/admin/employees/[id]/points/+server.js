import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin } from '$lib/server/config.js';

const MAX_DELTA = 1000;

// Add or subtract points for an employee: { delta: 5 } or { delta: -3 }. The
// adjustment stacks with points earned from claims.
export async function POST({ request, url, params }) {
  requireAdmin(request, url);
  const employee = db.getEmployeeById(Number(params.id));
  if (!employee) throw error(404, 'Employee not found');
  const body = await request.json().catch(() => ({}));
  const delta = Number(body.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_DELTA) {
    throw error(400, `Enter a whole number of points between -${MAX_DELTA} and ${MAX_DELTA}, like 5 or -3.`);
  }
  db.adjustPoints(employee.id, delta);
  const points = db.leaderboard().find((r) => r.id === employee.id)?.points ?? 0;
  return json({ points });
}
