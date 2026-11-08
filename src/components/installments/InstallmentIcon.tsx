import type { CSSProperties } from "react";
import {
  AirVent, Bike, Camera, Car, CreditCard, Gamepad2, GraduationCap, Headphones, HeartPulse, Landmark,
  Laptop, Package, Plane, Refrigerator, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sofa, Tablet,
  Tv, Wallet, WashingMachine, Watch, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { isInstallmentIcon, type InstallmentIconName } from "@/lib/installments";

const ICONS: Record<InstallmentIconName, LucideIcon> = {
  smartphone: Smartphone, laptop: Laptop, tablet: Tablet, headphones: Headphones, watch: Watch,
  camera: Camera, tv: Tv, "gamepad-2": Gamepad2, refrigerator: Refrigerator,
  "washing-machine": WashingMachine, "air-vent": AirVent, sofa: Sofa, car: Car, bike: Bike,
  shirt: Shirt, plane: Plane, "graduation-cap": GraduationCap, "heart-pulse": HeartPulse,
  "shopping-bag": ShoppingBag, "shopping-cart": ShoppingCart, "credit-card": CreditCard,
  landmark: Landmark, wallet: Wallet, package: Package,
};
const PALETTES = ["indigo", "sky", "violet", "cyan", "blue", "fuchsia", "teal", "orange", "emerald", "rose", "amber", "pink", "green", "slate"] as const;

export function InstallmentIconTile({ icon, size = "md", className }: { icon: unknown; size?: "sm" | "md" | "lg"; className?: string }) {
  const name: InstallmentIconName = isInstallmentIcon(icon) ? icon : "package";
  const Glyph = ICONS[name];
  const palette = PALETTES[Object.keys(ICONS).indexOf(name) % PALETTES.length];
  const style = { "--tile-from": `var(--cat-${palette}-1)`, "--tile-to": `var(--cat-${palette}-2)` } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "cat-tile flex shrink-0 items-center justify-center",
        size === "sm" ? "h-9 w-9 rounded-xl" : size === "lg" ? "h-12 w-12 rounded-2xl" : "h-10 w-10 rounded-xl",
        className
      )}
      style={style}
    >
      <Glyph className={size === "sm" ? "h-4 w-4" : size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]"} />
    </span>
  );
}
