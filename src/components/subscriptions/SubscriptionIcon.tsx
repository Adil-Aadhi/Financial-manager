import type { CSSProperties } from "react";
import {
  BookOpen,
  Bot,
  Briefcase,
  Camera,
  Car,
  Cloud,
  Code2,
  Database,
  Dumbbell,
  Film,
  Gamepad2,
  Headphones,
  HeartPulse,
  House,
  MessageCircle,
  Music2,
  Newspaper,
  Palette,
  Plane,
  Podcast,
  Repeat2,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tv,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_SUBSCRIPTION_ICON,
  isSubscriptionIcon,
  type SubscriptionIconName,
} from "@/lib/subscriptions";

const ICONS: Record<SubscriptionIconName, LucideIcon> = {
  "repeat-2": Repeat2,
  "music-2": Music2,
  film: Film,
  tv: Tv,
  bot: Bot,
  sparkles: Sparkles,
  wrench: Wrench,
  cloud: Cloud,
  "gamepad-2": Gamepad2,
  dumbbell: Dumbbell,
  "book-open": BookOpen,
  newspaper: Newspaper,
  "shopping-bag": ShoppingBag,
  wifi: Wifi,
  smartphone: Smartphone,
  "message-circle": MessageCircle,
  briefcase: Briefcase,
  palette: Palette,
  camera: Camera,
  headphones: Headphones,
  podcast: Podcast,
  "shield-check": ShieldCheck,
  "code-2": Code2,
  database: Database,
  "heart-pulse": HeartPulse,
  plane: Plane,
  car: Car,
  utensils: Utensils,
  house: House,
  zap: Zap,
};

const PALETTES = ["violet", "fuchsia", "rose", "blue", "cyan", "amber", "teal", "indigo", "orange", "emerald", "sky", "pink", "green", "slate"] as const;

function iconName(value: unknown): SubscriptionIconName {
  return isSubscriptionIcon(value) ? value : DEFAULT_SUBSCRIPTION_ICON;
}

export function SubscriptionIconTile({
  icon,
  size = "md",
  className,
}: {
  icon: unknown;
  size?: "sm" | "md";
  className?: string;
}) {
  const name = iconName(icon);
  const Glyph = ICONS[name];
  const palette = PALETTES[Object.keys(ICONS).indexOf(name) % PALETTES.length];
  const style = {
    "--tile-from": `var(--cat-${palette}-1)`,
    "--tile-to": `var(--cat-${palette}-2)`,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "cat-tile flex shrink-0 items-center justify-center rounded-xl",
        size === "sm" ? "h-9 w-9" : "h-10 w-10",
        className
      )}
      style={style}
    >
      <Glyph className={size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]"} />
    </span>
  );
}
