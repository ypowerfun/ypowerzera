import { Suspense } from "react";
import Link from "next/link";
import { Flash } from "@/components/flash";
import { requireAdmin } from "@/server/session";

const links = [["/admin", "Resumo"], ["/admin/kyc", "KYC"], ["/admin/saques", "Saques"], ["/admin/depositos", "Depósitos retidos"], ["/admin/desafios", "Desafios em disputa"], ["/admin/carteiras", "Carteiras e conciliação"]];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface/70 p-1.5" aria-label="Administração">
        {links.map(([h, l]) => <Link key={h} href={h} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-elevated hover:text-ink">{l}</Link>)}
      </nav>
      <Suspense fallback={null}><Flash /></Suspense>
      {children}
    </div>
  );
}
