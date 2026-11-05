import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { AddCategoryButton } from "@/components/categories/AddCategoryButton";
import { OfflineCategoryManager } from "@/components/categories/OfflineCategoryManager";
import type { CategoryRecord, CategoryType } from "@/lib/categories";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Categories | FinanceTracker",
  description: "Manage income and expense categories.",
};

export default async function CategoriesPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const supabase = await createClient();
  const categoriesResult = await supabase
    .from("categories")
    .select("id, name, type, icon, user_id, is_default")
    .or(`is_default.eq.true,user_id.eq.${user.id}`)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (categoriesResult.error) {
    console.error("Error fetching categories:", categoriesResult.error.message);
  }

  const categories: CategoryRecord[] = (categoriesResult.data ?? []).flatMap(
    (category) =>
      category.type === "income" || category.type === "expense"
        ? [
            {
              ...category,
              type: category.type as CategoryType,
              is_default: Boolean(category.is_default),
            },
          ]
        : []
  );

  const userName = profile.full_name || user.email?.split("@")[0] || "User";
  const defaultsReady = categories.filter((category) => category.is_default).length >= 17;

  return (
    <AppShell
      userName={userName}
      userEmail={user.email}
      currency={profile.default_currency}
    >
      <PageHeader
        eyebrow="Organization"
        title="Categories"
        description="Keep income and expense categories clear and consistent."
        action={!categoriesResult.error ? <AddCategoryButton /> : undefined}
      />

      <div className="space-y-5">
        {categoriesResult.error && (
          <Alert variant="warning" title="Using saved categories">
            The server copy could not be refreshed. Your last complete local snapshot is shown when available.
          </Alert>
        )}

        {!categoriesResult.error && !defaultsReady && (
          <Alert variant="warning" title="Database update required">
            Run the categories migration in Supabase to enable the protected default categories.
          </Alert>
        )}

        <OfflineCategoryManager ownerId={user.id} serverCategories={categories} />
      </div>
    </AppShell>
  );
}
