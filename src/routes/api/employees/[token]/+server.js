import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

export function GET({ params }) {
  const emp = db.getEmployeeByToken(params.token);
  if (!emp) throw error(404, 'Employee not found');
  return json({ id: emp.id, name: emp.name, token: emp.token });
}
