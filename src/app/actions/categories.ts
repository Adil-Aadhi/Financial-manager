"use server";

import { revalidatePath } from "next/cache";
import {
  isCategoryIcon,
  isCategoryType,
  type CategoryIconName,
  type CategoryType,
} from "@/lib/categories";
import { createClient } from "@/lib/supabase/server";

export interface CategoryActionInput {
  categoryId?: string;
  name: string;
  type: CategoryType;
  icon: CategoryIconName;
}

export interface CategoryActionResult {
  success: boolean;
  error?: string;
}

function validateCategoryInput(input: CategoryActionInput) {
  const name = input.name.trim();

  if (!name) return { error: "Category name is required." };
  if (name.length > 50) return { error: "Category name must be 50 characters or fewer." };
  if (!isCategoryType(input.type)) return { error: "Choose Income or Expense." };
  if (!isCategoryIcon(input.icon)) return { error: "Choose a valid category icon." };

  return { name };
}

async function getCategoryActionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

function categoryErrorMessage(code?: string) {
  if (code === "23505") {
    return "A category with this name already exists for that type.";
  }

  return "Unable to save this category.";
}

export async function createCategoryAction(
  input: CategoryActionInput
): Promise<CategoryActionResult> {
  const { supabase, user } = await getCategoryActionContext();

  if (!user) {
    return { success: false, error: "You must be signed in to add a category." };
  }

  const validated = validateCategoryInput(input);
  if (validated.error || !validated.name) {
    return { success: false, error: validated.error };
  }

  const { error } = await supabase.from("categories").insert({
    name: validated.name,
    type: input.type,
    icon: input.icon,
    user_id: user.id,
    is_default: false,
  });

  if (error) {
    console.error("Database error creating category:", error.message);
    return { success: false, error: categoryErrorMessage(error.code) };
  }

  revalidatePath("/categories");
  return { success: true };
}

export async function updateCategoryAction(
  input: CategoryActionInput
): Promise<CategoryActionResult> {
  const { supabase, user } = await getCategoryActionContext();

  if (!user) {
    return { success: false, error: "You must be signed in to edit a category." };
  }

  if (!input.categoryId) {
    return { success: false, error: "Category not found." };
  }

  const validated = validateCategoryInput(input);
  if (validated.error || !validated.name) {
    return { success: false, error: validated.error };
  }

  const { data, error } = await supabase
    .from("categories")
    .update({
      name: validated.name,
      type: input.type,
      icon: input.icon,
    })
    .eq("id", input.categoryId)
    .eq("user_id", user.id)
    .eq("is_default", false)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Database error updating category:", error.message);
    return { success: false, error: categoryErrorMessage(error.code) };
  }

  if (!data) {
    return { success: false, error: "Only your custom categories can be edited." };
  }

  revalidatePath("/categories");
  return { success: true };
}

export async function deleteCategoryAction(
  categoryId: string
): Promise<CategoryActionResult> {
  const { supabase, user } = await getCategoryActionContext();

  if (!user) {
    return { success: false, error: "You must be signed in to delete a category." };
  }

  if (!categoryId) {
    return { success: false, error: "Category not found." };
  }

  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("user_id", user.id)
    .eq("is_default", false)
    .maybeSingle();

  if (categoryError || !category) {
    return { success: false, error: "Only your custom categories can be deleted." };
  }

  const { count, error: usageError } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId)
    .eq("user_id", user.id);

  if (usageError) {
    console.error("Database error checking category usage:", usageError.message);
    return { success: false, error: "Unable to check whether this category is in use." };
  }

  if ((count ?? 0) > 0) {
    return {
      success: false,
      error: "This category is used by transactions and cannot be deleted.",
    };
  }

  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", categoryId)
    .eq("user_id", user.id)
    .eq("is_default", false)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Database error deleting category:", error.message);
    return {
      success: false,
      error:
        error.code === "23503"
          ? "This category is used by transactions and cannot be deleted."
          : "Unable to delete this category.",
    };
  }

  if (!data) {
    return { success: false, error: "Category not found." };
  }

  revalidatePath("/categories");
  return { success: true };
}
