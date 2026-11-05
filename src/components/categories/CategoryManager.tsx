"use client";

import React, { useMemo, useState } from "react";
import { Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { CategoryTile } from "@/components/categories/CategoryIcon";
import {
  CategoryFormModal,
  DeleteCategoryModal,
} from "@/components/categories/CategoryModals";
import { Button } from "@/components/ui/Button";
import type { CategoryRecord, CategoryType } from "@/lib/categories";
import { cn } from "@/lib/cn";

export function CategoryManager({ categories }: { categories: CategoryRecord[] }) {
  const [activeType, setActiveType] = useState<CategoryType>("income");
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<CategoryRecord | null>(null);

  const counts = useMemo(
    () => ({
      income: categories.filter((category) => category.type === "income").length,
      expense: categories.filter((category) => category.type === "expense").length,
    }),
    [categories]
  );

  const visibleCategories = categories.filter((category) => category.type === activeType);

  return (
    <>
      <section className="glass glass-edge rounded-2xl">
        <div
          role="tablist"
          aria-label="Category type"
          className="grid grid-cols-2 gap-2 border-b border-line p-3 sm:p-4"
        >
          {(["income", "expense"] as const).map((type) => {
            const active = activeType === type;
            return (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="category-panel"
                onClick={() => setActiveType(type)}
                className={cn(
                  "flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors",
                  active
                    ? type === "income"
                      ? "bg-positive/15 text-positive"
                      : "bg-danger/15 text-danger"
                    : "text-fg-muted hover:bg-glass-hover hover:text-fg"
                )}
              >
                <span>{type === "income" ? "Income Categories" : "Expense Categories"}</span>
                <span className="rounded-full border border-current/20 px-2 py-0.5 font-mono text-[10px]">
                  {counts[type]}
                </span>
              </button>
            );
          })}
        </div>

        <div
          id="category-panel"
          role="tabpanel"
          className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3"
        >
          {visibleCategories.map((category) => (
            <article
              key={category.id}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-glass-hover p-3.5 transition-colors hover:border-line-strong"
            >
              <CategoryTile icon={category.icon} size="md" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{category.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-subtle">
                  {category.is_default && <ShieldCheck className="h-3 w-3" />}
                  {category.is_default ? "Default" : "Custom"}
                </p>
              </div>

              {!category.is_default && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setEditingCategory(category)}
                    aria-label={`Edit ${category.name}`}
                    title="Edit category"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => setDeletingCategory(category)}
                    aria-label={`Delete ${category.name}`}
                    title="Delete category"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {editingCategory && (
        <CategoryFormModal
          key={editingCategory.id}
          category={editingCategory}
          isOpen
          onClose={() => setEditingCategory(null)}
        />
      )}

      {deletingCategory && (
        <DeleteCategoryModal
          key={deletingCategory.id}
          category={deletingCategory}
          isOpen
          onClose={() => setDeletingCategory(null)}
        />
      )}
    </>
  );
}
