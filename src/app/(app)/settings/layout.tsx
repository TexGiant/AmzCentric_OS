import { headers } from "next/headers";
import { requireAccess, requireAdminAccess } from "@/lib/access";

/** Settings are admin-only, except Settings → Claude connector (everyone connects their own). */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-pathname") ?? "";
  if (path === "/settings/claude" || path.startsWith("/settings/claude/")) await requireAccess();
  else await requireAdminAccess();
  return children;
}
