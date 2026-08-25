import { getStorefront } from "@/lib/storefront";

export default async function BuyerHome({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  const { merchant: slug } = await searchParams;
  if (!slug) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center">
        <p className="text-sm text-slate-400">
          Missing storefront. Append ?merchant=&lt;slug&gt; to the URL.
        </p>
      </main>
    );
  }
  const storefront = await getStorefront(slug);
  if (!storefront) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center">
        <p className="text-sm text-red-400">Storefront &quot;{slug}&quot; not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="border-b border-slate-800 p-4">
        <h1 className="text-lg font-semibold">Shopping with {storefront.name}</h1>
        <p className="text-xs text-slate-400">AI assistant · beta</p>
      </header>

      <div className="flex-1 space-y-3 p-4">
        <div className="max-w-[80%] rounded-2xl bg-slate-800 px-4 py-2 text-sm">
          Hi! I can help you find products from {storefront.name}. Ask me anything — chat arrives
          in the next phase.
        </div>
      </div>

      <form className="flex gap-2 border-t border-slate-800 p-4">
        <input
          disabled
          placeholder="Chat opens in Phase 4"
          className="flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm opacity-50"
        />
      </form>
    </main>
  );
}
