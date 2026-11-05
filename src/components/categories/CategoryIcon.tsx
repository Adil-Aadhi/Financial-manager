import type React from "react";
import {
  Briefcase,
  Building2,
  Car,
  CircleDollarSign,
  CircleEllipsis,
  Film,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Laptop,
  Plane,
  Receipt,
  ShoppingBag,
  Sparkles,
  Tags,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  laptop: Laptop,
  "building-2": Building2,
  "trending-up": TrendingUp,
  gift: Gift,
  "circle-dollar-sign": CircleDollarSign,
  utensils: Utensils,
  car: Car,
  "shopping-bag": ShoppingBag,
  receipt: Receipt,
  house: House,
  "heart-pulse": HeartPulse,
  "graduation-cap": GraduationCap,
  film: Film,
  plane: Plane,
  sparkles: Sparkles,
  "circle-ellipsis": CircleEllipsis,
};

/** Each icon owns one colour from the `--cat-*` palette in globals.css. */
const CATEGORY_COLORS: Record<string, string> = {
  briefcase: "emerald",
  laptop: "cyan",
  "building-2": "indigo",
  "trending-up": "green",
  gift: "pink",
  "circle-dollar-sign": "teal",
  utensils: "orange",
  car: "blue",
  "shopping-bag": "pink",
  receipt: "amber",
  house: "teal",
  "heart-pulse": "rose",
  "graduation-cap": "indigo",
  film: "violet",
  plane: "sky",
  sparkles: "fuchsia",
  "circle-ellipsis": "slate",
};

export function categoryColor(icon?: string | null) {
  return CATEGORY_COLORS[icon ?? ""] ?? "slate";
}

/** CSS variables that drive the `cat-tile` / `cat-fill` utilities. */
export function categoryStyle(icon?: string | null): React.CSSProperties {
  const color = categoryColor(icon);
  return {
    "--tile-from": `var(--cat-${color}-1)`,
    "--tile-to": `var(--cat-${color}-2)`,
  } as React.CSSProperties;
}

export function CategoryIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[name] ?? Tags;
  return <Icon aria-hidden="true" className={cn("h-5 w-5", className)} />;
}

const TILE_SIZES = {
  sm: "h-8 w-8 rounded-[10px] [&_svg]:h-4 [&_svg]:w-4",
  md: "h-10 w-10 rounded-xl [&_svg]:h-[18px] [&_svg]:w-[18px]",
  lg: "h-12 w-12 rounded-2xl [&_svg]:h-5 [&_svg]:w-5",
} as const;

/** Glossy gradient tile with a white category glyph. */
export function CategoryTile({
  icon,
  size = "md",
  className,
}: {
  icon?: string | null;
  size?: keyof typeof TILE_SIZES;
  className?: string;
}) {
  return (
    <span
      style={categoryStyle(icon)}
      className={cn(
        "cat-tile flex shrink-0 items-center justify-center",
        TILE_SIZES[size],
        className
      )}
    >
      <CategoryIcon name={icon ?? ""} />
    </span>
  );
}
