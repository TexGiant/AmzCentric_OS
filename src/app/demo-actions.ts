"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_USERS, DEMO_USER_COOKIE } from "@/lib/demo-users";
import { isDemoMode } from "@/lib/env";

/** Dev-only: switch the sample user in demo mode. Refused when connected to real data. */
export async function switchDemoUser(form: FormData) {
  if (!isDemoMode()) return;
  const id = String(form.get("user") ?? "");
  if (!DEMO_USERS.some((u) => u.userId === id)) return;
  (await cookies()).set(DEMO_USER_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax" });
  redirect("/dashboard");
}
