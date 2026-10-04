import { Suspense } from "react";
import { AdminNav } from "@/components/admin-nav";
import { Flash } from "@/components/flash";
import { requireAdmin } from "@/server/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <AdminNav />
      <Suspense fallback={null}><Flash /></Suspense>
      {children}
    </div>
  );
}
