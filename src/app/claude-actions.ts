"use server";

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { oauthStore } from "@/lib/oauth/store";
import { can } from "@/lib/rbac";

/** Disconnect one Claude connection (your own, or anyone's if you're an admin). */
export async function disconnectClaude(form: FormData) {
  const a = await requireAccess();
  const family = String(form.get("family") ?? "");
  const store = oauthStore();
  const visible = await store.listConnections(can(a, "connector_admin") ? null : a.userId);
  const conn = visible.find((c) => c.family === family);
  if (conn) {
    await store.revokeFamily(family);
    await audit({ action: "connector.disconnect", actor: a, target: conn.email ?? family, detail: { client: conn.clientName } });
  }
  revalidatePath("/settings/claude");
}
