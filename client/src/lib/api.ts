/**
 * Typed fetch wrapper. All requests are `credentials: "include"` so the
 * httpOnly auth cookies are always attached. On 401 for GP routes we
 * attempt a single silent refresh, then retry once.
 */

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function attemptRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/gp/refresh", {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function api<T>(
  path: string,
  opts: {
    method?: Method;
    body?: unknown;
    retried?: boolean;
  } = {}
): Promise<T> {
  const { method = "GET", body, retried } = opts;
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    if (await attemptRefresh()) {
      return api<T>(path, { ...opts, retried: true });
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface MeResponse {
  sub: string;
  role: "gp" | "lp";
}
