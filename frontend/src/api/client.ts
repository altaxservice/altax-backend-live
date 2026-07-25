// Set VITE_API_BASE_URL at build time only if the frontend and backend are ever split
// across two separate hosts. The default single-service deployment (server.ts serves
// this build itself) needs no override — production calls the API on its own origin
// (empty string = relative paths), and only local `vite dev` (a separate :5173 port
// from the :4000 API) falls back to localhost.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://localhost:4000" : "");

/** Uploaded-file URLs from the backend are relative (e.g. /documents/uploads/:id/download) since they're served by the API, not the frontend's own origin — this resolves them to an absolute link everywhere a file is opened/downloaded. External links (Drive, etc.) pass through unchanged. */
export function resolveFileUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.startsWith("/") ? `${API_BASE_URL}${url}` : url;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let authToken: string | null = localStorage.getItem("altax_token");

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem("altax_token", token);
  else localStorage.removeItem("altax_token");
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401) setAuthToken(null);
    throw new ApiError(data?.error || res.statusText || "Request failed", res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
};

export async function fetchAuthedBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await res.json() : null;
    throw new ApiError(data?.error || res.statusText || "Request failed", res.status);
  }
  return res.blob();
}

/** Downloads a file (PDF, etc.) that requires auth — plain <a href> can't carry the JWT, so this fetches as a blob and triggers a save via a temporary object URL. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await fetchAuthedBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Opens a file (PDF, etc.) that requires auth in a new tab for viewing/printing,
 * rather than forcing a download. The tab is opened synchronously, before the
 * `await` below, so it's still attached to the click's user gesture — opening
 * it after the fetch resolves gets silently blocked as a popup by Safari and
 * Chrome, since by then the browser no longer considers it user-initiated.
 */
export async function viewFile(path: string): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const blob = await fetchAuthedBlob(path);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.open(url, "_blank");
  } catch (err) {
    win?.close();
    throw err;
  }
}

/**
 * Opens/downloads a stored file URL, which is either this app's own internal
 * route (relative, e.g. "/documents/uploads/xyz/download" — needs the JWT
 * viewFile/downloadFile attach) or a client-pasted external link (Google
 * Drive, etc. — already public, no auth to attach, and fetching it as a blob
 * would likely hit CORS anyway). Same "/" branch resolveFileUrl already uses
 * to decide whether to prepend API_BASE_URL. Centralized here so every list/
 * detail page that renders an attachment gets both actions the same way,
 * instead of each one reinventing (and forgetting) the auth-header handling.
 */
export async function openAnyFile(url: string): Promise<void> {
  if (url.startsWith("/")) return viewFile(url);
  window.open(url, "_blank", "noopener,noreferrer");
}
export async function downloadAnyFile(url: string, filename: string): Promise<void> {
  if (url.startsWith("/")) return downloadFile(url, filename);
  window.open(url, "_blank", "noopener,noreferrer");
}
