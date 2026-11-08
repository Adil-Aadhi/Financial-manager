import type { CSSProperties } from "react";
import {
  Baby, BookOpen, Building2, Bus, CalendarDays, Car, CircleEllipsis, Droplets,
  Flame, GraduationCap, HeartHandshake, HeartPulse, House, Landmark, Phone,
  ReceiptText, ShieldCheck, Smartphone, Tv, Wifi, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { DEFAULT_BILL_ICON, isBillIcon, type BillIconName } from "@/lib/bills";

const ICONS: Record<BillIconName, LucideIcon> = {
  "receipt-text": ReceiptText, wifi: Wifi, smartphone: Smartphone, zap: Zap,
  droplets: Droplets, house: House, "shield-check": ShieldCheck,
  "heart-handshake": HeartHandshake, "graduation-cap": GraduationCap,
  landmark: Landmark, car: Car, "heart-pulse": HeartPulse, "building-2": Building2,
  flame: Flame, tv: Tv, phone: Phone, bus: Bus, "book-open": BookOpen, baby: Baby,
  wrench: Wrench, "calendar-days": CalendarDays, "circle-ellipsis": CircleEllipsis,
};
const PALETTES = ["amber", "sky", "orange", "cyan", "violet", "emerald", "rose", "indigo", "blue", "fuchsia", "teal", "green", "pink", "slate"] as const;

export function BillIconTile({ icon, size = "md", className }: { icon: unknown; size?: "sm" | "md"; className?: string }) {
  const name = isBillIcon(icon) ? icon : DEFAULT_BILL_ICON;
  const Glyph = ICONS[name];
  const palette = PALETTES[Object.keys(ICONS).indexOf(name) % PALETTES.length];
  const style = { "--tile-from": `var(--cat-${palette}-1)`, "--tile-to": `var(--cat-${palette}-2)` } as CSSProperties;
  return (
    <span aria-hidden="true" className={cn("cat-tile flex shrink-0 items-center justify-center rounded-xl", size === "sm" ? "h-9 w-9" : "h-10 w-10", className)} style={style}>
      <Glyph className={size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]"} />
    </span>
  );
}
