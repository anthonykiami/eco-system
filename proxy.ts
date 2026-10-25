import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PREFIXES = ["/api/auth/", "/api/cron/", "/api/jobs/"];
const PUBLIC_EXACT = ["/login", "/api/telegram"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_EXACT.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/**
 * Optimistic routing only — pages, route handlers, and server actions must still
 * check the session themselves (see lib/auth/session.ts).
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const user = req.auth?.user;
  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const onWaitlistPage = pathname === "/waitlist";
  if (user.status === "waitlist" && !onWaitlistPage) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Waitlisted" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/waitlist", req.nextUrl));
  }
  if (user.status === "active" && onWaitlistPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Skip Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
