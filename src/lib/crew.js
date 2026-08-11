import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'geocache_crew';

function initial() {
  if (!browser) return null;
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

// The current crew ({ id, name, token }) or null. Persisted to localStorage so
// a crew stays signed in across visits, shared by every page.
export const crew = writable(initial());

if (browser) {
  crew.subscribe((v) => {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  });
}
