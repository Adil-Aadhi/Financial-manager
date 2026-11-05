"use client";

import React, { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/app/actions/categories";
import { CategoryTile } from "@/components/categories/CategoryIcon";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  CATEGORY_ICON_OPTIONS,
  type CategoryIconName,
  type CategoryRecord,
  type CategoryType,
} from "@/lib/categories";
import { cn } from "@/lib/cn";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

interface CategoryFormModalProps {
  category?: CategoryRecord;
  isOpen: boolean;
  onClose: () => void;
}

export function CategoryFormModal({
  category,
  isOpen,
  onClose,
}: CategoryFormModalProps) {
  const [name, setName] = useState(category?.name ?? "");
  const [type, setType] = useState<CategoryType>(category?.type ?? "income");
  const [icon, setIcon] = useState<CategoryIconName>(
    CATEGORY_ICON_OPTIONS.some((option) => option.value === category?.icon)
      ? (category?.icon as CategoryIconName)
      : "circle-ellipsis"
  );
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isOnline = useOnlineStatus();

  const isEditing = Boolean(category);

  const closeAndReset = () => {
    if (isPending) return;
    if (!isEditing) {
      setName("");
      setType("income");
      setIcon("circle-ellipsis");
    }
    setError(null);
    setNameError(null);
    onClose();
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isOnline) {
      setError("Connect to the internet to save category changes.");
      return;
    }
    setError(null);
    setNameError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Category name is required.");
      return;
    }

    startTransition(async () => {
      const input = {
        categoryId: category?.id,
        name: trimmedName,
        type,
        icon,
      };
      const result = isEditing
        ? await updateCategoryAction(input)
        : await createCategoryAction(input);

      if (!result.success) {
        setError(result.error ?? "Unable to save this category.");
        return;
      }

      if (!isEditing) {
        setName("");
        setType("income");
        setIcon("circle-ellipsis");
      }
      onClose();
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeAndReset}
      title={isEditing ? "Edit Category" : "Add Category"}
      description={
        isEditing
          ? "Update the name, type, or icon for this custom category."
          : "Create a category for your income or expenses."
      }
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!isOnline && (
          <Alert variant="info">Category changes require an internet connection.</Alert>
        )}

        <Input
          label="Category Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(null);
          }}
          error={nameError ?? undefined}
          maxLength={50}
          disabled={isPending || !isOnline}
          required
          autoFocus
        />

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-fg-muted">Type</legend>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-glass-input p-1">
            {(["income", "expense"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                disabled={isPending || !isOnline}
                aria-pressed={type === option}
                className={cn(
                  "h-10 cursor-pointer rounded-lg text-xs font-semibold capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  type === option
                    ? option === "income"
                      ? "bg-positive/15 text-positive"
                      : "bg-danger/15 text-danger"
                    : "text-fg-muted hover:bg-glass-hover hover:text-fg"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-fg-muted">Icon</legend>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">
            {CATEGORY_ICON_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setIcon(option.value)}
                disabled={isPending || !isOnline}
                aria-label={option.label}
                aria-pressed={icon === option.value}
                title={option.label}
                className="group flex cursor-pointer items-center justify-center py-1 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CategoryTile
                  icon={option.value}
                  size="sm"
                  className={cn(
                    "transition-transform duration-200 group-active:scale-90",
                    icon === option.value
                      ? "scale-110 outline-2 outline-offset-2 outline-(--tile-from)"
                      : "opacity-75 group-hover:opacity-100"
                  )}
                />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={closeAndReset} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isPending} disabled={!isOnline}>
            {isPending ? "Saving…" : isEditing ? "Save Changes" : "Add Category"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteCategoryModal({
  category,
  isOpen,
  onClose,
}: {
  category: CategoryRecord;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isOnline = useOnlineStatus();

  const handleDelete = () => {
    if (!isOnline) {
      setError("Connect to the internet to delete this category.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteCategoryAction(category.id);
      if (!result.success) {
        setError(result.error ?? "Unable to delete this category.");
        return;
      }
      onClose();
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Category?"
      description="This only deletes an unused custom category."
      size="sm"
    >
      <div className="space-y-5">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!isOnline && (
          <Alert variant="info">Deleting a category requires an internet connection.</Alert>
        )}

        <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger/8 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger/12 text-danger">
            <Trash2 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{category.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              Categories already used by transactions are protected and cannot be deleted.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleDelete}
            isLoading={isPending}
            disabled={!isOnline}
          >
            {isPending ? "Deleting…" : "Delete Category"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function AddCategoryModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return <CategoryFormModal isOpen={isOpen} onClose={onClose} />;
}
