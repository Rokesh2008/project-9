export const API =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export const TOKEN_KEY = 'project9_access_token';

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}
