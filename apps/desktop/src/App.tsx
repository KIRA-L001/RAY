import { useState } from "react";
import { ApiClient, type Session } from "@ray/api-client";

// ponytail: token lives in module state only; reload = re-login until the Tauri secure-store integration lands
let accessToken = "";
const api = new ApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
  getToken: () => accessToken,
});

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      const result = await api.auth.login(String(form.get("email")), String(form.get("password")));
      accessToken = result.accessToken;
      setSession(await api.auth.me());
    } catch {
      setError("Invalid email or password");
    }
  }

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm items-center">
        <form onSubmit={login} className="w-full space-y-4">
          <h1 className="text-xl font-semibold">RAY Desktop</h1>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <input name="email" type="email" required placeholder="Email" className="input" />
          <input name="password" type="password" required placeholder="Password" className="input" />
          <button type="submit">Log in</button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">RAY Desktop</h1>
          <p className="text-sm opacity-60">{session.email}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            accessToken = "";
            setSession(null);
            void api.auth.logout().catch(() => {});
          }}
        >
          Log out
        </button>
      </header>
      <h2 className="mb-2 text-sm font-medium opacity-60">Your merchants</h2>
      <ul className="space-y-1">
        {session.memberships.map((m) => (
          <li key={m.merchantId} className="rounded border border-slate-700 px-3 py-2">
            {m.name} <span className="opacity-50">({m.role})</span>
          </li>
        ))}
        {session.memberships.length === 0 ? (
          <li className="opacity-60">No merchants yet — create one via the API.</li>
        ) : null}
      </ul>
    </main>
  );
}
