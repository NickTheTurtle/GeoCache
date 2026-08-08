import { error } from '@sveltejs/kit';
import QRCode from 'qrcode';
import * as db from '$lib/server/db.js';
import { requireAdmin, claimUrl } from '$lib/server/config.js';

// QR code for a zone -> PNG that points at the claim page.
export async function GET({ request, url, params }) {
  requireAdmin(request, url);
  const zone = db.getZoneById(Number(params.id));
  if (!zone) throw error(404, 'Zone not found');
  const target = claimUrl(url, zone);
  const png = await QRCode.toBuffer(target, { width: 512, margin: 2 });
  const headers = { 'Content-Type': 'image/png' };
  if (url.searchParams.get('download')) {
    headers['Content-Disposition'] = `attachment; filename="qr-${zone.name.replace(/\W+/g, '_')}.png"`;
  }
  return new Response(png, { headers });
}
