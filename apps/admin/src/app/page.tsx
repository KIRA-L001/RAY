import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_TOKEN_COOKIE, apiAdminMerchants, apiMe } from "@/lib/api";

export default async function AdminDashboard() {
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value ?? "";
  const session = await apiMe(token);
  if (!session) redirect("/login");
  if (!session.adminRole) {
    return <p className="p-8">Your account is not a RAY admin.</p>;
  }
  const merchants = await apiAdminMerchants(token);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">RAY Admin</h1>
          <p className="text-sm text-slate-400">
            {session.email} · {session.adminRole}
          </p>
        </div>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
          >
            Log out
          </button>
        </form>
      </header>

      <h2 className="mb-3 font-medium text-slate-300">Merchants</h2>
      {merchants === null ? (
        <p className="text-red-400">Failed to load merchants.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="py-2">Name</th>
              <th>Slug</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((m) => (
              <tr key={m.id} className="border-t border-slate-800">
                <td className="py-2">{m.name}</td>
                <td>{m.slug}</td>
                <td>{m.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
