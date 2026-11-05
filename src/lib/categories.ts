export const CATEGORY_TYPES = ["income", "expense"] as const;

export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CATEGORY_ICON_OPTIONS = [
  { value: "briefcase", label: "Briefcase" },
  { value: "laptop", label: "Laptop" },
  { value: "building-2", label: "Business" },
  { value: "trending-up", label: "Investment" },
  { value: "gift", label: "Gift" },
  { value: "circle-dollar-sign", label: "Money" },
  { value: "utensils", label: "Dining" },
  { value: "car", label: "Car" },
  { value: "shopping-bag", label: "Shopping" },
  { value: "receipt", label: "Bills" },
  { value: "house", label: "Housing" },
  { value: "heart-pulse", label: "Healthcare" },
  { value: "graduation-cap", label: "Education" },
  { value: "film", label: "Entertainment" },
  { value: "plane", label: "Travel" },
  { value: "sparkles", label: "Personal care" },
  { value: "circle-ellipsis", label: "Other" },
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_OPTIONS)[number]["value"];

export interface CategoryRecord {
  id: string;
  name: string;
  type: CategoryType;
  icon: string;
  user_id: string | null;
  is_default: boolean;
}

export function isCategoryType(value: string): value is CategoryType {
  return CATEGORY_TYPES.includes(value as CategoryType);
}

export function isCategoryIcon(value: string): value is CategoryIconName {
  return CATEGORY_ICON_OPTIONS.some((option) => option.value === value);
}
