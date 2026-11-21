"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { LinkSpinner } from "@/components/link-pending";
import { startNavigation } from "@/components/nav-progress";
import {
  BarChart3,
  Bot,
  Boxes,
  Clock,
  Database,
  GitCompareArrows,
  LayoutGrid,
  ListChecks,
  ListTodo,
  FileSpreadsheet,
  MessagesSquare,
  NotebookPen,
  LogOut,
  Megaphone,
  Menu,
  Package,
  PlugZap,
  Search,
  Tags,
  Target,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { Avatar, cn, Logo, selectClass } from "@/components/ui";
import type { AccessSummary, Perm } from "@/lib/rbac";

type Brand = { slug: string; name: string; countries: string[] };
type Item = { href: string; label: string; icon: React.ElementType; soon?: string; exact?: boolean; perm?: Perm };

const STROKE = 1.5;

export function Sidebar({
  brands,
  access,
  demo,
  signOut,
  demoUsers,
  switchDemoUser,
}: {
  /** Only the brands this person may see (filtered on the server). */
  brands: Brand[];
  access: AccessSummary;
  demo: boolean;
  signOut: () => Promise<void>;
  /** Dev-only sample users (demo mode). */
  demoUsers?: Array<{ id: string; label: string; active: boolean }>;
  switchDemoUser?: (form: FormData) => Promise<void>;
}) {
  const email = access.email;
  const isAdmin = access.admin;
  const perms = new Set(access.perms);
  const allowed = (i: Item) => !i.perm || perms.has(i.perm);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, startSwitch] = useTransition();
  const [pendingBrand, setPendingBrand] = useState<string | null>(null);
  useEffect(() => setOpen(false), [pathname]);

  const match = pathname.match(/^\/dashboard\/([^/]+)/);
  const current = brands.find((b) => b.slug === match?.[1]) ?? null;
  const slug = current?.slug ?? brands[0]?.slug;

  const groups: Array<{ label: string; items: Item[] }> = slug
    ? [
        {
          label: "Workspace",
          items: [
            { href: `/dashboard/${slug}`, label: "Overview", icon: LayoutGrid, exact: true, perm: "overview" },
            { href: `/dashboard/${slug}/reports`, label: "Reports", icon: FileSpreadsheet, perm: "reports" },
            { href: `/dashboard/${slug}/what-changed`, label: "What Changed", icon: GitCompareArrows, perm: "what_changed" },
            { href: `/dashboard/${slug}/goals`, label: "Goals", icon: Target, perm: "goals.view" },
          ],
        },
        {
          label: "Advertising",
          items: [
            { href: `/dashboard/${slug}/campaigns`, label: "Campaigns", icon: Megaphone, perm: "campaigns" },
            { href: `/dashboard/${slug}/search-terms`, label: "Search Terms", icon: Search, perm: "search_terms" },
            { href: `/dashboard/${slug}/hourly`, label: "Hourly", icon: Clock, perm: "hourly" },
          ],
        },
        {
          label: "Products & market",
          items: [
            { href: `/dashboard/${slug}/products`, label: "Products", icon: Package, perm: "products" },
            { href: `/dashboard/${slug}/inventory`, label: "Inventory", icon: Boxes, soon: "SP-API", perm: "catalog_inventory" },
          ],
        },
        {
          label: "Work",
          items: [
            { href: `/dashboard/${slug}/meetings`, label: "Meetings", icon: MessagesSquare, perm: "meetings.view" },
            { href: `/dashboard/${slug}/tasks`, label: "Tasks", icon: ListTodo, perm: "tasks.view" },
            { href: `/dashboard/${slug}/actions`, label: "Action Log", icon: ListChecks, perm: "actions.view" },
          ],
        },
      ]
        .map((g) => ({ ...g, items: (g.items as Item[]).filter(allowed) }))
        .filter((g) => g.items.length > 0)
    : [];

  // Settings are admin-only, except connecting your own Claude.
  const settings: Item[] = ([
    { href: "/settings/team", label: "Team", icon: Users, perm: "settings" as Perm },
    { href: "/settings/brands", label: "Brands", icon: Tags, perm: "settings" as Perm },
    { href: "/settings/connections", label: "Connections", icon: PlugZap, perm: "settings" as Perm },
    { href: "/settings/sync", label: "Data Sync", icon: Database, perm: "settings" as Perm },
    { href: "/settings/meetings", label: "Meeting capture", icon: NotebookPen, perm: "settings" as Perm },
    { href: "/settings/audit", label: "Audit log", icon: ScrollText, perm: "audit_log" as Perm },
    { href: "/settings/claude", label: "Claude connector", icon: Bot },
  ] as Item[]).filter(allowed);
  void isAdmin;

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <div className="flex h-full flex-col">
      <div className="relative px-5 pt-6 pb-5">
        <Link href="/dashboard" aria-label="AmzCentric OS home" className="inline-block">
          <Logo size="nav" />
        </Link>
        <button
          className="absolute top-5 right-2.5 rounded-lg p-1 text-muted hover:bg-surface lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <X className="size-5" strokeWidth={STROKE} />
        </button>
      </div>

      <div className="px-4">
        <label className="block">
          <span className="mb-2 block px-3 text-[11px] font-bold tracking-[0.14em] text-faint uppercase">Brand</span>
          <div className="relative">
          <select
            value={switching && pendingBrand !== null ? pendingBrand : (current?.slug ?? "")}
            onChange={(e) => {
              const slug = e.target.value;
              setPendingBrand(slug);
              startNavigation();
              startSwitch(() => router.push(slug ? `/dashboard/${slug}` : "/dashboard"));
            }}
            aria-busy={switching}
            className={cn(selectClass, "font-semibold", switching && "border-brand text-muted")}
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
                {b.countries.length ? ` · ${b.countries.join(", ")}` : ""}
              </option>
            ))}
          </select>
          {switching && (
            <span className="pointer-events-none absolute top-1/2 right-9 flex -translate-y-1/2 items-center gap-1.5 text-xs font-bold text-brand-ink">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
              Loading
            </span>
          )}
          </div>
        </label>
      </div>

      <nav className="mt-5 flex-1 space-y-5 overflow-y-auto px-4 pb-6">
        <div>
          <NavItem href="/dashboard" label="All Brands" icon={BarChart3} active={pathname === "/dashboard"} />
          {perms.has("tasks.view") && <NavItem href="/tasks" label="My Tasks" icon={ListTodo} active={pathname === "/tasks"} />}
        </div>
        {brands.length === 0 && (
          <p className="rounded-lg bg-surface px-3 py-2.5 text-xs text-muted">No brands assigned to you yet. Ask an admin to add you to a brand.</p>
        )}
        {groups.map((g) => (
          <Section key={g.label} label={g.label}>
            {g.items.map((i) => (
              <NavItem key={i.href} {...i} active={isActive(i.href, i.exact)} />
            ))}
          </Section>
        ))}
        <Section label="Settings">
          {settings.map((i) => (
            <NavItem key={i.href} {...i} active={isActive(i.href)} />
          ))}
        </Section>
      </nav>

      <div className="border-t border-line px-4 py-4">
        {demo && <div className="mb-3 rounded-lg bg-gold-100 px-3 py-2 text-xs font-bold text-gold-800">Demo data: connect Supabase to go live</div>}
        {demo && demoUsers && switchDemoUser && (
          <form action={switchDemoUser} className="mb-3">
            <label className="block">
              <span className="mb-1 block px-1 text-[10px] font-bold tracking-[0.14em] text-faint uppercase">Dev · view as</span>
              <select
                name="user"
                aria-label="View as sample user"
                defaultValue={demoUsers.find((u) => u.active)?.id}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className={cn(selectClass, "h-9 text-xs")}
              >
                {demoUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          </form>
        )}
        <div className="flex items-center gap-3 px-1">
          <Avatar email={email} />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-2" title={email}>
            {email}
          </span>
          {!demo && (
            <form action={signOut}>
              <button className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" strokeWidth={STROKE} />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        <Logo size="sm" />
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg p-2 text-ink hover:bg-canvas">
          <Menu className="size-5" strokeWidth={STROKE} />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-navy-800/45 backdrop-blur-[4px] lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[248px] overflow-hidden border-r border-line bg-canvas transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {nav}
      </aside>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-3 pb-2 text-[11px] font-bold tracking-[0.14em] text-faint uppercase">{label}</div>
      {children}
    </div>
  );
}

function NavItem({ href, label, icon: Icon, active, soon }: Item & { active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors",
        active ? "bg-brand-soft text-brand-ink" : "text-muted hover:bg-surface hover:text-ink",
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={STROKE} />
      <span className="flex-1">{label}</span>
      {soon && <span className="rounded-pill bg-surface px-2 py-0.5 text-[10px] font-bold text-faint ring-1 ring-line">{soon}</span>}
      <LinkSpinner className="text-brand-ink" />
    </Link>
  );
}
