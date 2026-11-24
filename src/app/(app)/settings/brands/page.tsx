import Link from "next/link";
import { Card, CardHeader, PageHeader, buttonClass, cn, inputClass, selectClass } from "@/components/ui";
import { BrandForm } from "@/components/settings-forms";
import { deleteBrand, renameBrand, saveCaseStudySettings } from "@/app/settings-actions";
import { PendingButton } from "@/components/settings-forms";
import { brandCaseStudySettings } from "@/lib/case-studies";
import { isDemoMode } from "@/lib/env";
import { requireAdminAccess } from "@/lib/access";
import { data } from "@/lib/data";

export default async function BrandsPage() {
  const user = await requireAdminAccess();
  const brands = await data().listBrands();
  const cs = await brandCaseStudySettings();
  const settings = new Map(cs.brands.map((b) => [b.slug, b]));
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Brands"
        subtitle="Each brand (client) gets its own workspace. Assign Amazon profiles to a brand under Connections."
      />
      <Card>
        <CardHeader title="Add a brand" />
        <BrandForm />
      </Card>
      <Card className="mt-4">
        <CardHeader title={`${brands.length} brands`} />
        <ul className="divide-y divide-line">
          {brands.map((b) => (
            <li key={b.slug} className="flex flex-wrap items-center gap-3 px-6 py-4">
              <form action={renameBrand} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="slug" value={b.slug} />
                <input name="name" defaultValue={b.name} className={cn(inputClass, "max-w-xs font-semibold")} aria-label="Brand name" />
                <button className={cn(buttonClass.ghost, buttonClass.small)}>Rename</button>
              </form>
              <span className="text-xs text-muted">
                /{b.slug} · {b.profileCount} profile{b.profileCount === 1 ? "" : "s"} {b.countries.length ? `· ${b.countries.join(", ")}` : ""}
              </span>
              <Link href={`/dashboard/${b.slug}`} className={cn(buttonClass.secondary, buttonClass.small)}>
                Open
              </Link>
              {true && (
                <form action={deleteBrand}>
                  <input type="hidden" name="slug" value={b.slug} />
                  <button className={buttonClass.danger} title="Deletes the brand, its goals and action log. Profiles become unassigned.">
                    Delete
                  </button>
                </form>
              )}
              {cs.ready && (
              <form action={saveCaseStudySettings} className="flex basis-full flex-wrap items-end gap-2 rounded-lg bg-canvas/70 px-3 py-2.5">
                <input type="hidden" name="slug" value={b.slug} />
                <label className="text-xs font-semibold text-muted">
                  Category
                  <input name="category" defaultValue={settings.get(b.slug)?.category ?? ""} placeholder="e.g. Supplements" className={cn(inputClass, "mt-1 h-9 w-48 text-sm")} />
                </label>
                <label className="text-xs font-semibold text-muted">
                  Case studies
                  <select name="consent" defaultValue={settings.get(b.slug)?.consent ?? "none"} className={cn(selectClass, "mt-1 h-9 w-64 text-sm")}>
                    <option value="none">Not allowed</option>
                    <option value="anonymized">Allowed, anonymized (category only)</option>
                    <option value="named">Allowed with name (client agreed in writing)</option>
                  </select>
                </label>
                <PendingButton pendingText="Saving…" className={cn(buttonClass.secondary, buttonClass.small)}>
                  Save
                </PendingButton>
              </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {!cs.ready && (
        <p className="mt-3 rounded-lg bg-gold-100 px-3 py-2 text-xs font-semibold text-gold-800">
          Case study settings appear here after migration 0008_case_study_settings.sql is run in Supabase.
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Case studies: the case study bot only sees measured Action Log wins from brands marked Allowed, with names, campaigns and ASINs removed.
        Choose "with name" only after the client agrees in writing.{isDemoMode() ? " (Demo mode: settings can't be saved.)" : ""}
      </p>
    </>
  );
}
