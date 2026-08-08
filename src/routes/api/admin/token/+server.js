import { json } from '@sveltejs/kit';
import { requireAdmin, makeAdminToken } from '$lib/server/config.js';

// Mint a short-lived signed token the admin UI can put in <img>/<a> URLs (QR
// codes) so the admin password never appears in a URL.
export function GET({ request, url }) {
  requireAdmin(request, url);
  return json({ token: makeAdminToken() });
}
