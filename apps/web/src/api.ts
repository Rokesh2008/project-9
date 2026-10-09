export const API =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export const TOKEN_KEY = 'project9_access_token';
const pendingReads = new Map<string, Promise<Response>>();

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const method=(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  // Coalesce simultaneous identical reads only. Nothing is cached after the
  // response; keys include identity and no caller-owned AbortSignal is shared.
  if(method==='GET' && !init.signal && !(input instanceof Request)) {
    const key=`${String(input)}:${JSON.stringify([...headers])}:${init.credentials??''}:${init.cache??''}`;
    let pending=pendingReads.get(key);
    if(!pending) {
      pending=fetch(input,{...init,headers});
      pendingReads.set(key,pending);
      void pending.finally(()=>{if(pendingReads.get(key)===pending)pendingReads.delete(key);}).catch(()=>{});
    }
    return pending.then(response=>response.clone());
  }
  if(method!=='GET' && method!=='HEAD')pendingReads.clear();
  return fetch(input, { ...init, headers });
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  pendingReads.clear();
}
