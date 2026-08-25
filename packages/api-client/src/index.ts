import type { ApiResult } from "@ray/types";

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
}

export interface Session {
  id: string;
  email: string;
  adminRole: string | null;
  memberships: MembershipInfo[];
}

export interface MembershipInfo {
  merchantId: string;
  name: string;
  slug: string;
  role: string;
}

export interface MerchantSummary {
  id: string;
  name: string;
  slug: string;
}

export interface MemberInfo {
  userId: string;
  email: string;
  role: string;
}

export interface Storefront {
  id: string;
  name: string;
  slug: string;
}

export type WebsiteStatus =
  | "PENDING"
  | "CRAWLING"
  | "EXTRACTING"
  | "NORMALIZING"
  | "EMBEDDING"
  | "READY"
  | "FAILED";

export interface WebsiteSummary {
  id: string;
  merchantId?: string;
  url: string;
  hostname: string;
  status: WebsiteStatus;
  errorCode?: string | null;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token, or undefined for anonymous calls. */
  getToken?: () => string | undefined | Promise<string | undefined>;
}

type Query = Record<string, string | undefined>;

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Thrown on non-2xx; `code` comes from the API error envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Query; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.auth) {
      const token = await this.options.getToken?.();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const res = await fetch(buildUrl(this.options.baseUrl, path, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const payload = (await res.json().catch(() => null)) as ApiResult<T> | null;
    if (!res.ok || !payload || payload.ok === false) {
      const error = payload && payload.ok === false ? payload.error : null;
      throw new ApiError(res.status, error?.code ?? `HTTP_${res.status}`, error?.message ?? res.statusText);
    }
    return payload.data;
  }

  readonly auth = {
    login: (email: string, password: string) =>
      this.request<LoginResult>("POST", "/v1/auth/login", { body: { email, password } }),
    register: (email: string, password: string) =>
      this.request<LoginResult>("POST", "/v1/auth/register", { body: { email, password } }),
    refresh: () => this.request<LoginResult>("POST", "/v1/auth/refresh"),
    logout: () => this.request<{ ok: true }>("POST", "/v1/auth/logout"),
    me: () => this.request<Session>("GET", "/v1/auth/me", { auth: true }),
  };

  readonly merchants = {
    create: (name: string) => this.request<MerchantSummary>("POST", "/v1/merchants", { body: { name }, auth: true }),
    listMine: () => this.request<MembershipInfo[]>("GET", "/v1/me/memberships", { auth: true }),
    listMembers: (merchantId: string) =>
      this.request<MemberInfo[]>("GET", `/v1/merchants/${merchantId}/members`, { auth: true }),
    addMember: (merchantId: string, email: string, role: "VIEWER" | "MANAGER" | "ADMIN") =>
      this.request<MemberInfo>("POST", `/v1/merchants/${merchantId}/members`, {
        body: { email, role },
        auth: true,
      }),
  };

  readonly websites = {
    create: (merchantId: string, url: string) =>
      this.request<WebsiteSummary>("POST", `/v1/merchants/${merchantId}/websites`, {
        body: { url },
        auth: true,
      }),
    list: (merchantId: string) =>
      this.request<WebsiteSummary[]>("GET", `/v1/merchants/${merchantId}/websites`, { auth: true }),
    get: (merchantId: string, websiteId: string) =>
      this.request<WebsiteSummary>("GET", `/v1/merchants/${merchantId}/websites/${websiteId}`, {
        auth: true,
      }),
  };

  readonly storefront = {
    get: (slug: string) => this.request<Storefront>("GET", `/v1/storefronts/${encodeURIComponent(slug)}`),
  };

  readonly admin = {
    listMerchants: () =>
      this.request<Array<MerchantSummary & { status: string; createdAt: string }>>(
        "GET",
        "/v1/admin/merchants",
        { auth: true },
      ),
  };
}
