import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_TOKEN_COOKIE, apiMe } from "@/lib/api";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value ?? "";
  if (await apiMe(token)) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center">
      <form action="/api/auth/login" method="POST" className="w-full space-y-4">
        <h1 className="text-xl font-semibold">RAY Admin</h1>
        {error ? <p className="text-sm text-red-400">Invalid email or password.</p> : null}
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500"
        >
          Log in
        </button>
      </form>
    </main>
  );
}
