import Link from "next/link";
import { Card, Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <Empty title="Not found">
        That brand or page doesn&apos;t exist. <Link href="/dashboard" className="text-brand hover:underline">Back to all brands</Link>
      </Empty>
    </Card>
  );
}
