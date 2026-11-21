import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Claude connector endpoints authenticate with OAuth bearer tokens, not cookies.
const PUBLIC = ["/login", "/auth/", "/api/cron/", "/account/set-password", "/.well-known/", "/api/oauth/", "/api/mcp", "/api/meetings/ingest"];

/**
 * Request headers for the app, with x-pathname set by us (any value the browser sent is
 * replaced). Layouts use it to check page permissions before streaming starts, so a
 * forbidden URL gets a real 404 status.
 */
function forwarded(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return { headers };
}

/** Refreshes the Supabase session cookie and sends signed-out visitors to /login. */
export async function proxy(request: NextRequest) {
  const demo = process.env.DEMO_MODE === "true" || !process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (demo) return NextResponse.next({ request: forwarded(request) });

  let response = NextResponse.next({ request: forwarded(request) });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: forwarded(request) });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && !PUBLIC.some((p) => path.startsWith(p))) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp)$).*)"],
};
