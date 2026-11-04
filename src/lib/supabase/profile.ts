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

/**
 * Fetches the authenticated user and their profile from public.profiles.
 * Handles missing profile records gracefully without exposing other profiles.
 */
export async function getAuthenticatedUserProfile() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, profile: null };
  }

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
}
