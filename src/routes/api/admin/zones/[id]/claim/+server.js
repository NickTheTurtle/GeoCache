import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin } from '$lib/server/config.js';

// Manually claim a zone for an employee (no QR scan needed).
export async function POST({ request, url, params }) {
  requireAdmin(request, url);
  const id = Number(params.id);
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  const body = await request.json().catch(() => ({}));
  const employee = db.getEmployeeById(Number(body.employeeId));
  if (!employee) throw error(400, 'Unknown employee');
  const result = db.claimZone(id, employee.id);
  return json({ ...result, employee: { id: employee.id, name: employee.name } });
}
