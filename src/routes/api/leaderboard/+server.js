import { json } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

export function GET() {
  return json(db.leaderboard());
}
