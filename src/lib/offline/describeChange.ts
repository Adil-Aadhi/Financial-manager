import "client-only";

import { offlineDb, type OutboxEntry } from "@/lib/offline/db";
import { normalizeTransactionDate } from "@/lib/transactions";

function amountText(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : "";
}

function dateText(value: unknown) {
  const date = typeof value === "string" ? normalizeTransactionDate(value) : "";
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

/** A short, human description of a queued change, e.g. "Added expense 250 · 5 Nov". */
export async function describeChange(entry: OutboxEntry): Promise<string> {
  const payload = entry.payload;
  switch (entry.entity) {
    case "transaction": {
      const stored = await offlineDb.transactions.get([entry.ownerId, entry.entityId]);
      const source = { ...(stored ?? {}), ...payload } as Record<string, unknown>;
      const kind = source.type === "income" ? "income" : "expense";
      const details = [amountText(source.amount), dateText(source.transaction_date)].filter(Boolean).join(" · ");
      if (entry.op === "DELETE") return "Deleted a transaction";
      return `${entry.op === "CREATE" ? "Added" : "Edited"} ${kind}${details ? ` ${details}` : ""}`;
    }
    case "account": {
      const stored = await offlineDb.accounts.get([entry.ownerId, entry.entityId]);
      const name = String(payload.name ?? stored?.name ?? "an account");
      if (entry.op === "CREATE") return `Added account “${name}”`;
      if ("deleted_at" in payload) return payload.deleted_at === null ? `Restored account “${name}”` : `Moved account “${name}” to Trash`;
      return `Edited account “${name}”`;
    }
    case "category": {
      const stored = await offlineDb.categories.get([entry.ownerId, entry.entityId]);
      const name = String(payload.name ?? stored?.name ?? "");
      if (entry.op === "DELETE") return name ? `Deleted category “${name}”` : "Deleted a category";
      return `${entry.op === "CREATE" ? "Added" : "Edited"} category “${name}”`;
    }
    case "budget":
      return entry.op === "DELETE" ? "Removed the monthly budget" : `Set the monthly budget to ${amountText(payload.amount)}`;
  }
}
