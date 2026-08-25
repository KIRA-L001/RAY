// ponytail: access token lives 15 min and expiry = re-login; silent refresh wiring arrives with the shared API client (Task 18)
const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const ADMIN_TOKEN_COOKIE = "ray_admin_access";

export interface AdminSession {
  id: string;
  email: string;
  adminRole: string | null;
}

export async function apiLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken ?? "";
}

/** Returns session info or null when the token is missing/invalid. */
export async function apiMe(token: string): Promise<AdminSession | null> {
  if (!token) return null;
  const res = await fetch(`${API_URL}/v1/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as AdminSession;
}

export async function apiAdminMerchants(token: string) {
  const res = await fetch(`${API_URL}/v1/admin/merchants`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as Array<{ id: string; name: string; slug: string; status: string }>;
}
