import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'care_employee';
// Where the signed-in player was stored before the rename to "employee"; read
// once so nobody is signed out by the change, then removed.
const LEGACY_KEY = 'geocache_crew';

function initial() {
  if (!browser) return null;
  try {
    const saved = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_KEY);
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

// The current employee ({ id, name, token }) or null. Persisted to localStorage so
// an employee stays signed in across visits, shared by every page.
export const employee = writable(initial());

if (browser) {
  employee.subscribe((v) => {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  });
}
