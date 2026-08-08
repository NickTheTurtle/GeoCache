import { json } from '@sveltejs/kit';
import { SF_BOUNDS } from '$lib/server/config.js';

export function GET() {
  return json({ sfBounds: SF_BOUNDS });
}
