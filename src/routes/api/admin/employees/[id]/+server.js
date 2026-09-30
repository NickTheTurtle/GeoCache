import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, parseId } from '$lib/server/config.js';

// Delete an employee along with their claims and point adjustments. Their
// personal link stops working.
export function DELETE({ request, url, params }) {
  requireAdmin(request, url);
  if (!db.deleteEmployee(parseId(params.id))) throw error(404, 'Employee not found');
  return json({ ok: true });
}
