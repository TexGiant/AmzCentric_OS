export const dynamic = "force-dynamic";

import { Sidebar } from "@/components/sidebar";
import { signOut } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { data } from "@/lib/data";
import { isDemoMode } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brands = await data().listBrands();
  return (
    <div className="min-h-dvh">
      <Sidebar
        brands={brands.map((b) => ({ slug: b.slug, name: b.name, countries: b.countries }))}
        email={user.email}
        isAdmin={user.role === "admin"}
        demo={isDemoMode()}
        signOut={signOut}
      />
      <main className="lg:pl-[248px]">
        <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
