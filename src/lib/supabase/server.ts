import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

export async function createClient() {
    // Supabase auth checks session expiry with Date.now(). Under Cache Components that is a
    // per-request value, so wait for a real request before any auth call. Cookies alone don't
    // defer it (cookies are available during runtime prefetch). Auth data must never be prerendered.
    await connection();
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // Cookie updates are handled by the Next.js Proxy.
                    }
                },
            },
        }
    );
}