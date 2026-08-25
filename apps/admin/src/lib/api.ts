import { ApiClient } from "@ray/api-client";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const ADMIN_TOKEN_COOKIE = "ray_admin_access";

export interface AdminSession {
  id: string;
  email: string;
  adminRole: string | null;
}

// Server-side client: token passed per call from the session cookie.
export const api = new ApiClient({ baseUrl: API_URL });

export async function apiLogin(email: string, password: string): Promise<string> {
  try {
    const result = await api.auth.login(email, password);
    return result.accessToken;
  } catch {
    return "";
  }
}

/** Returns session info or null when the token is missing/invalid. */
export async function apiMe(token: string): Promise<AdminSession | null> {
  if (!token) return null;
  // ponytail: per-call token override until ApiClient supports request-scoped tokens
  try {
    const res = await fetch(`${API_URL}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: true; data: AdminSession };
    return body.data;
  } catch {
    return null;
  }
}

export async function apiAdminMerchants(token: string) {
  try {
    const res = await fetch(`${API_URL}/v1/admin/merchants`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok: true;
      data: Array<{ id: string; name: string; slug: string; status: string }>;
    };
    return body.data;
  } catch {
    return null;
  }
}
