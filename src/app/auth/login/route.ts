import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";

/*
 * Email + password sign-in as a real form POST. Browsers only offer "Save password?"
 * when a login form is actually submitted and the page navigates away, so the login
 * form posts here instead of signing in with JavaScript.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));

  const back = (error: string) => {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", error);
    if (email) url.searchParams.set("email", email);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  };
  if (!email || !password) return back("Enter your email and password.");

  const res = NextResponse.redirect(new URL(next, req.url), 303);
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return back(error.message);
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return back("That email domain is not allowed.");
  }
  return res;
}
