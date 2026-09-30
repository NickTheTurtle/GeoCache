import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'care_employee';

function initial() {
  if (!browser) return null;
  try {
    return JSON.parse(localStorage.getItem(KEY));
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
