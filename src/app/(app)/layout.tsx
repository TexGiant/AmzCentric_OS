export const dynamic = "force-dynamic";

import { HrBar } from "@/components/hr-checkin";
import { Sidebar } from "@/components/sidebar";
import { signOut } from "@/app/actions";
import { switchDemoUser } from "@/app/demo-actions";
import { requireAccess } from "@/lib/access";
import { data } from "@/lib/data";
import { DEMO_USERS } from "@/lib/demo-users";
import { isDemoMode } from "@/lib/env";
import { summarize } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const brands = await data().listBrands(); // only the brands this person may see
  const demo = isDemoMode();
  return (
    <div className="min-h-dvh">
      <Sidebar
        brands={brands.map((b) => ({ slug: b.slug, name: b.name, countries: b.countries }))}
        access={summarize(access)}
        demo={demo}
        signOut={signOut}
        demoUsers={demo ? DEMO_USERS.map((u) => ({ id: u.userId, label: `${u.label} (${u.email})`, active: u.userId === access.userId })) : undefined}
        switchDemoUser={demo ? switchDemoUser : undefined}
      />
      <main className="lg:pl-[248px]">
        <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">
          <HrBar access={access} />
          {children}
        </div>
      </main>
    </div>
  );
}
