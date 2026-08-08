import { redirect } from '@sveltejs/kit';

// The claim flow now lives in a modal on the main page. Redirect any old QR
// links (/claim?c=<secret>) to the map, which pops the claim modal from ?c=.
export function load({ url }) {
  const c = url.searchParams.get('c');
  throw redirect(307, c ? `/?c=${encodeURIComponent(c)}` : '/');
}
