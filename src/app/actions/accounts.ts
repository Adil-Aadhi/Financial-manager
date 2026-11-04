"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface CreateAccountInput {
  name: string;
  startingAmount?: number;
}

export interface CreateAccountResult {
  success: boolean;
  error?: string;
  account?: {
    id: string;
    name: string;
    opening_balance?: number;
  };
}

export async function createAccountAction({
  name,
  startingAmount = 0,
}: CreateAccountInput): Promise<CreateAccountResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in to create an account." };
  }

  const trimmedName = name?.trim();
  if (!trimmedName) {
    return { success: false, error: "Account Name is required." };
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      user_id: user.id,
      name: trimmedName,
      opening_balance: Number(startingAmount) || 0,
    })
    .select("id, name, opening_balance")
    .single();

  if (error) {
    console.error("Database error creating account:", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/transactions");
  revalidatePath("/home");

  return {
    success: true,
    account: data,
  };
}
