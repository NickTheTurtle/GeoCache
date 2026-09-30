import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'care_employee';

function initial() {
  if (!browser) return null;
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v.token === 'string' && typeof v.name === 'string' ? v : null;
  } catch {
    return null;
  }
}

// The current employee ({ id, name, token }) or null. Persisted to localStorage so
// an employee stays signed in across visits, shared by every page.
export const employee = writable(initial());

if (browser) {
  employee.subscribe((v) => {
    // Storage can be blocked (strict privacy settings): stay signed in for this
    // page instead of breaking sign-in.
    try {
      if (v) localStorage.setItem(KEY, JSON.stringify(v));
      else localStorage.removeItem(KEY);
    } catch {
      /* not persisted */
    }
  });
}
