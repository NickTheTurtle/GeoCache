import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, readBody, parseId } from '$lib/server/config.js';

// Manually unclaim a zone for an employee.
export async function POST({ request, url, params }) {
  requireAdmin(request, url);
  const id = parseId(params.id);
  const body = await readBody(request);
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  const employee = db.getEmployeeById(Number(body.employeeId));
  if (!employee) throw error(400, 'Unknown employee');
  const result = db.unclaimZone(id, employee.id);
  return json(result);
}
