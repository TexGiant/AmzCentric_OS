"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAuthorizationCode, issuer, validateAuthorizeRequest } from "@/lib/oauth";

const KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

/** Approve or deny the Claude connector, then send the browser back to Claude. */
export async function decideAuthorization(form: FormData) {
  const user = await requireUser();
  const params = Object.fromEntries(KEYS.map((k) => [k, (form.get(k) as string | null) || undefined]));
  const req = await validateAuthorizeRequest(params); // re-checked: never trust hidden fields
  const back = new URL(req.redirectUri);
  if (req.state) back.searchParams.set("state", req.state);
  if (form.get("decision") !== "allow") {
    back.searchParams.set("error", "access_denied");
    redirect(back.toString());
  }
  back.searchParams.set("code", await createAuthorizationCode(req, user.id));
  back.searchParams.set("iss", issuer());
  redirect(back.toString());
}
