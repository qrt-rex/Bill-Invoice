// Two backends: the billing API (all billing data) and the main application's API, used only
// to sign in. The React app never talks to a database, and holds no secrets.
export const BILLING_API = import.meta.env.VITE_BILLING_API_URL ?? 'http://localhost:8020';
export const AUTH_API = import.meta.env.VITE_AUTH_API_URL ?? 'http://localhost:8000';
export const MAIN_APP_URL = import.meta.env.VITE_MAIN_APP_URL ?? '';

const TOKEN_KEY = 'rex-billing-token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage blocked: the session still lives in memory for this tab.
    }
  },
  key: TOKEN_KEY,
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

function friendlyMessage(status: number, detail: unknown): string {
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail[0]?.msg) {
    const d = detail[0];
    const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : '';
    const msg = String(d.msg).replace(/^Value error, /, '');
    return field && typeof field === 'string' ? `${field.replace(/_/g, ' ')}: ${msg}` : msg;
  }
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'The requested record was not found.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  if (status >= 500) return 'The server ran into a problem. Please try again.';
  return 'Something went wrong. Please try again.';
}

async function raw(base: string, path: string, init: RequestInit = {}): Promise<Response> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 401 && token) onUnauthorized?.();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(friendlyMessage(res.status, body.detail ?? body.message), res.status);
  }
  return res;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Query): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

function client(base: string) {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await raw(base, path, init);
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
  };
  return {
    get: <T>(path: string, params: Query = {}) => request<T>(path + qs(params)),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    /** Authenticated file download (plain links can't carry the bearer token). */
    blob: async (path: string, params: Query = {}) => (await raw(base, path + qs(params))).blob(),
  };
}

export const api = client(`${BILLING_API}/api/billing`);
export const authApi = client(AUTH_API);

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
