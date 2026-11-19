"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { oauthStore } from "@/lib/oauth/store";

/** Disconnect one Claude connection (your own, or anyone's if you're an admin). */
export async function disconnectClaude(form: FormData) {
  const user = await requireUser();
  const family = String(form.get("family") ?? "");
  const store = oauthStore();
  const mine = await store.listConnections(user.role === "admin" ? null : user.id);
  if (mine.some((c) => c.family === family)) await store.revokeFamily(family);
  revalidatePath("/settings/claude");
}
