import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Password resets are admin-only. An admin's "Send password reset" stamps the user's
 * app_metadata (which users can't edit) before Supabase emails the link; a reset link is only
 * honoured while that stamp is fresh, and it's cleared once used.
 */

const VALID_FOR_MS = 24 * 60 * 60 * 1000;

export function adminResetPending(appMetadata: Record<string, unknown> | undefined | null): boolean {
  const at = appMetadata?.reset_requested_at;
  if (typeof at !== "string") return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && Date.now() - t < VALID_FOR_MS;
}

export async function markAdminReset(userId: string, byEmail: string) {
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
    app_metadata: { reset_requested_at: new Date().toISOString(), reset_requested_by: byEmail },
  });
  if (error) throw new Error(error.message);
}

export async function clearAdminReset(userId: string) {
  await createAdminClient().auth.admin.updateUserById(userId, { app_metadata: { reset_requested_at: null, reset_requested_by: null } });
}

/** The sign-in method recorded in a Supabase access token ("password", "recovery", "otp", …). */
export function sessionMethods(accessToken: string | undefined): string[] {
  try {
    const payload = JSON.parse(Buffer.from(accessToken!.split(".")[1], "base64url").toString("utf8")) as { amr?: Array<{ method?: string }> };
    return (payload.amr ?? []).map((a) => a.method ?? "");
  } catch {
    return [];
  }
}
