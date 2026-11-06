import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";

/** "+₹100.00" / "−₹50.00" / "₹0.00": balances show their sign explicitly. */
export function signedMoney(amount: number, currency: SupportedCurrency) {
  if (amount === 0) return formatMoney(0, currency);
  return `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount), currency)}`;
}

/** Keep digits and one decimal point, max two decimals (same as the monthly budget form). */
export function sanitizeAmount(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  if (rest.length === 0) return whole.slice(0, 12);
  return `${whole.slice(0, 12)}.${rest.join("").slice(0, 2)}`;
}

export function currencySymbol(code: string) {
  try {
    return (
      new Intl.NumberFormat("en-IN", { style: "currency", currency: code })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? code
    );
  } catch {
    return code;
  }
}
