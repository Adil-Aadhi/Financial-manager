import type { Metadata } from "next";
import { CategoriesPageContent } from "@/components/categories/CategoriesPageContent";

export const metadata: Metadata = {
  title: "Categories | AccountTracker",
  description: "Manage income and expense categories.",
};

export default function CategoriesPage() {
  return <CategoriesPageContent />;
}
