import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type SupportedCurrency = "INR" | "USD" | "AED";

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  default_currency: SupportedCurrency;
  created_at?: string;
  updated_at?: string;
}

/** The verified identity a page needs, taken from the session's JWT claims. */
export interface AuthenticatedUser {
  id: string;
  email?: string;
  user_metadata: Record<string, unknown>;
}

/**
 * Fetches the authenticated user and their profile from public.profiles.
 * Handles missing profile records gracefully without exposing other profiles.
 *
 * Identity comes from getClaims(): the session's access token is refreshed if it has expired,
 * then its expiry and signature are verified (locally with this project's ES256 signing keys,
 * or through the Auth server with a symmetric key). This is for rendering pages only;
 * Server Actions keep calling getUser() before any write, and RLS verifies the same JWT on
 * every query below.
 */
export const getAuthenticatedUserProfile = cache(async function getAuthenticatedUserProfile() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (authError || !claims?.sub) {
    return { user: null, profile: null };
  }

  const user: AuthenticatedUser = {
    id: claims.sub,
    email: claims.email,
    user_metadata: claims.user_metadata ?? {},
  };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, default_currency, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Error fetching user profile:", profileError.message);
  }

  // Graceful fallback for missing profile rows
  const resolvedProfile: Profile = {
    id: user.id,
    full_name:
      profile?.full_name ??
      (user.user_metadata?.full_name as string) ??
      "",
    avatar_url: profile?.avatar_url ?? null,
    default_currency:
      (profile?.default_currency as SupportedCurrency) || "USD",
    created_at: profile?.created_at,
    updated_at: profile?.updated_at,
  };

  return { user, profile: resolvedProfile };
});
