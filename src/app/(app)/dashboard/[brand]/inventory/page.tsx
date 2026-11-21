import { Boxes } from "lucide-react";
import { Card, Empty, PageHeader } from "@/components/ui";
import { getBrandOr404, type BrandParams } from "@/lib/page";

export default async function InventoryPage({ params }: { params: BrandParams }) {
  const { brand: slug } = await params;
  const brand = await getBrandOr404(slug, "catalog_inventory");
  return (
    <>
      <PageHeader eyebrow="Products & market" title="Inventory" subtitle={brand.name} />
      <Card>
        <Empty icon={<Boxes className="size-8" strokeWidth={1.5} />} title="Waiting on SP-API">
          Once your Selling Partner API app is approved, this page will show FBA + AWD stock, days of cover at the current
          sales pace, and which advertised ASINs are about to stock out, so ads can be paused before they waste spend.
        </Empty>
      </Card>
    </>
  );
}
