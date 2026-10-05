import { clearAuth } from './auth';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('token');
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init?.body && typeof init.body === 'string') headers['content-type'] ??= 'application/json';

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearAuth();
    window.location.hash = '#/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  if (res.headers.get('content-type')?.includes('json')) return res.json();
  return undefined as T;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body != null ? JSON.stringify(body) : undefined }),
  upload: <T = unknown>(path: string, formData: FormData) =>
    request<T>(path, {
      method: 'POST',
      body: formData,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
};
