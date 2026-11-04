import type { SupportedCurrency } from "@/lib/supabase/profile";

const LOCALE: Record<SupportedCurrency, string> = {
  INR: "en-IN",
  USD: "en-US",
  AED: "en-AE",
};

/** Format an amount in the user's currency, e.g. ₹1,25,000.00 / $1,250.00 / AED 1,250.00 */
export function formatMoney(amount: number, currency: SupportedCurrency, opts?: { compact?: boolean }) {
  return new Intl.NumberFormat(LOCALE[currency] ?? "en-US", {
    style: "currency",
    currency,
    notation: opts?.compact ? "compact" : "standard",
    minimumFractionDigits: opts?.compact ? 0 : 2,
    maximumFractionDigits: opts?.compact ? 1 : 2,
  }).format(amount);
}

export function initialsOf(nameOrEmail: string) {
  const parts = nameOrEmail.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] ?? "U").toUpperCase();
}
