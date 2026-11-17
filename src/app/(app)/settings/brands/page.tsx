import Link from "next/link";
import { Card, CardHeader, PageHeader, buttonClass, cn, inputClass } from "@/components/ui";
import { BrandForm } from "@/components/settings-forms";
import { deleteBrand, renameBrand } from "@/app/settings-actions";
import { requireUser } from "@/lib/auth";
import { data } from "@/lib/data";

export default async function BrandsPage() {
  const user = await requireUser();
  const brands = await data().listBrands();
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
              {user.role === "admin" && (
                <form action={deleteBrand}>
                  <input type="hidden" name="slug" value={b.slug} />
                  <button className={buttonClass.danger} title="Deletes the brand, its goals and action log. Profiles become unassigned.">
                    Delete
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
