"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Boxes,
  ChevronsUpDown,
  Clock,
  Database,
  GitCompareArrows,
  LayoutGrid,
  ListChecks,
  LogOut,
  Megaphone,
  Menu,
  Package,
  PlugZap,
  Search,
  Tags,
  Target,
  Users,
  X,
} from "lucide-react";
import { cn, Logo } from "@/components/ui";

type Brand = { slug: string; name: string; countries: string[] };

const STROKE = 1.5;

export function Sidebar({
  brands,
  email,
  isAdmin,
  demo,
  signOut,
}: {
  brands: Brand[];
  email: string;
  isAdmin: boolean;
  demo: boolean;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const match = pathname.match(/^\/dashboard\/([^/]+)/);
  const current = brands.find((b) => b.slug === match?.[1]) ?? null;
  const slug = current?.slug ?? brands[0]?.slug;

  const groups: Array<{ label: string; items: Array<{ href: string; label: string; icon: React.ElementType; soon?: string; exact?: boolean }> }> = slug
    ? [
        {
          label: "Overview",
          items: [
            { href: `/dashboard/${slug}`, label: "Overview", icon: LayoutGrid, exact: true },
            { href: `/dashboard/${slug}/what-changed`, label: "What Changed", icon: GitCompareArrows },
            { href: `/dashboard/${slug}/goals`, label: "Goals", icon: Target },
          ],
        },
        {
          label: "Advertising",
          items: [
            { href: `/dashboard/${slug}/campaigns`, label: "Campaigns", icon: Megaphone },
            { href: `/dashboard/${slug}/search-terms`, label: "Search Terms", icon: Search },
            { href: `/dashboard/${slug}/hourly`, label: "Hourly", icon: Clock },
          ],
        },
        {
          label: "Products & Market",
          items: [
            { href: `/dashboard/${slug}/products`, label: "Products", icon: Package },
            { href: `/dashboard/${slug}/inventory`, label: "Inventory", icon: Boxes, soon: "SP-API" },
          ],
        },
        {
          label: "Work",
          items: [{ href: `/dashboard/${slug}/actions`, label: "Action Log", icon: ListChecks }],
        },
      ]
    : [];

  const settings = [
    { href: "/settings/connections", label: "Connections", icon: PlugZap },
    { href: "/settings/brands", label: "Brands", icon: Tags },
    { href: "/settings/sync", label: "Data Sync", icon: Database },
    ...(isAdmin ? [{ href: "/settings/team", label: "Team", icon: Users }] : []),
  ];

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="size-5 text-muted" strokeWidth={STROKE} />
        </button>
      </div>

      <div className="px-3">
        <label className="relative block">
          <span className="sr-only">Brand</span>
          <select
            value={current?.slug ?? ""}
            onChange={(e) => router.push(e.target.value ? `/dashboard/${e.target.value}` : "/dashboard")}
            className="w-full appearance-none rounded-xl border border-line bg-surface py-2.5 pr-9 pl-3 text-sm font-medium text-ink focus:border-brand focus:outline-none"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
                {b.countries.length ? ` · ${b.countries.join(", ")}` : ""}
              </option>
            ))}
          </select>
          <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-faint" strokeWidth={STROKE} />
        </label>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
        <NavItem href="/dashboard" label="All Brands" icon={BarChart3} active={pathname === "/dashboard"} />
        {groups.map((g) => (
          <div key={g.label} className="mt-5">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{g.label}</div>
            {g.items.map((i) => (
              <NavItem key={i.href} {...i} active={isActive(i.href, i.exact)} />
            ))}
          </div>
        ))}
        <div className="mt-5">
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Settings</div>
          {settings.map((i) => (
            <NavItem key={i.href} {...i} active={isActive(i.href)} />
          ))}
        </div>
      </nav>

      <div className="border-t border-line px-4 py-3">
        {demo && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[11px] font-medium text-warn">
            <Activity className="size-3.5" strokeWidth={STROKE} /> Demo data
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted" title={email}>
            {email}
          </span>
          {!demo && (
            <form action={signOut}>
              <button className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label="Sign out" title="Sign out">
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
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg p-1.5 hover:bg-canvas">
          <Menu className="size-5" strokeWidth={STROKE} />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-surface transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {nav}
      </aside>
    </>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  soon,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  soon?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
        active ? "bg-brand-soft font-medium text-brand-ink" : "text-ink-2 hover:bg-canvas hover:text-ink",
      )}
    >
      <Icon className={cn("size-[18px]", active ? "text-brand" : "text-faint")} strokeWidth={STROKE} />
      <span className="flex-1">{label}</span>
      {soon && <span className="rounded-md bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-faint">{soon}</span>}
    </Link>
  );
}
