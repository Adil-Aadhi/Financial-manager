import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Protected routes definition
  const protectedRoutes = [
    "/home",
    "/transactions",
    "/categories",
    "/reports",
    "/settings",
    "/accounts",
    "/trash",
  ];
  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Auth routes definition
  const isAuthRoute = pathname === "/login" || pathname === "/register";

  // Check if any Supabase authentication cookies are present
  const allCookies = request.cookies.getAll();
  const hasAuthCookies = allCookies.some((cookie) =>
    cookie.name.startsWith("sb-")
  );

  // --- SUPABASE DOCS OPTIMIZATION ---
  // If the user has NO auth cookies:
  // 1. Direct unauthenticated access to protected routes: redirect immediately to /login
  //    (Avoids an unnecessary blocking HTTPS network call to Supabase Auth).
  if (!hasAuthCookies && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 2. Unauthenticated access to public/auth routes (/login, /register, /forgot-password, /):
  //    Allow through immediately with zero auth network overhead.
  if (!hasAuthCookies && (isAuthRoute || !isProtectedRoute)) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }

  // User HAS auth cookies: Initialize Supabase client and validate/refresh the session
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do NOT use getSession(). getUser() validates the token with Supabase Auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Rule 1: Invalid/expired session on protected routes -> redirect to /login
  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    // Copy any refreshed/cleared cookies onto the redirect response
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  }

  // Rule 2: Authenticated users visiting /login or /register -> redirect to /home
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    const redirectResponse = NextResponse.redirect(url);
    // Copy any refreshed cookies onto the redirect response
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}
