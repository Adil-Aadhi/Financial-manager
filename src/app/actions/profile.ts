"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { SupportedCurrency } from "@/lib/supabase/profile";

export interface UpdateProfileInput {
  fullName: string;
  defaultCurrency: SupportedCurrency;
}

export interface UpdateProfileResponse {
  success: boolean;
  error?: string;
  data?: {
    fullName: string;
    defaultCurrency: SupportedCurrency;
  };
}

export async function updateProfile(
  input: UpdateProfileInput
): Promise<UpdateProfileResponse> {
  const supabase = await createClient();

  // 1. Verify authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "Authentication required. Please sign in again.",
    };
  }

  // 2. Validate inputs
  const fullName = input.fullName?.trim();
  const defaultCurrency = input.defaultCurrency?.toUpperCase() as SupportedCurrency;

  if (!fullName) {
    return {
      success: false,
      error: "Full name cannot be empty.",
    };
  }

  if (fullName.length > 100) {
    return {
      success: false,
      error: "Full name must be 100 characters or fewer.",
    };
  }

  const allowedCurrencies: SupportedCurrency[] = ["INR", "USD", "AED"];
  if (!allowedCurrencies.includes(defaultCurrency)) {
    return {
      success: false,
      error: "Invalid currency. Please select USD, INR, or AED.",
    };
  }

  // 3. Update public.profiles scoped strictly to authenticated user's UUID
  const { data: updatedProfile, error: dbError } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      default_currency: defaultCurrency,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (dbError) {
    console.error("Database error updating profile:", dbError.message);
    return {
      success: false,
      error: `Failed to update profile: ${dbError.message}`,
    };
  }

  if (!updatedProfile) {
    return {
      success: false,
      error: "Profile not found.",
    };
  }

  // 4. Synchronize user_metadata full_name on Supabase Auth
  const { error: metadataError } = await supabase.auth.updateUser({
    data: { full_name: fullName },
  });

  if (metadataError) {
    console.warn("Could not sync user_metadata full_name:", metadataError.message);
  }

  // 5. Revalidate protected routes
  revalidatePath("/settings");
  revalidatePath("/home");
  revalidatePath("/transactions");
  revalidatePath("/reports");

  return {
    success: true,
    data: {
      fullName,
      defaultCurrency,
    },
  };
}
