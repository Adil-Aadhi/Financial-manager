import { EMPTY_LEDGER_ROWS, LEDGER_COLUMNS, LEDGER_OBLIGATION_LEGACY_COLUMNS, type LedgerRows } from "@/lib/ledger";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const MISSING_OBJECT_CODES = new Set(["42P01", "PGRST205", "42703"]);
const PAGE_SIZE = 1000;

export interface LedgerServerData extends LedgerRows {
  /** false until the Personal Ledger migration has been applied. */
  available: boolean;
}

const UNAVAILABLE: LedgerServerData = { ...EMPTY_LEDGER_ROWS, available: false };

/**
 * The user's ledger rows, read-only. Used for the first render and as the fallback before the
 * device has its own complete copy; once it has, the pages read IndexedDB instead.
 *
 * The eight tables are independent reads (no query needs another's result), so they are fetched
 * at the same time; each table's own pages are still fetched one after another. Results are
 * assembled the same way as before: a table that doesn't exist yet makes the whole feature
 * unavailable, and any other error on a table is logged and keeps the rows read so far.
 */
export async function getLedgerServerData(supabase: ServerClient, userId: string): Promise<LedgerServerData> {
  const tables = [
    ["ledger_people", "people"],
    ["ledger_groups", "groups"],
    ["ledger_members", "members"],
    ["ledger_member_rates", "rates"],
    ["ledger_member_spans", "spans"],
    ["ledger_expenses", "expenses"],
    ["ledger_obligations", "obligations"],
    ["ledger_payments", "payments"],
  ] as const;

  const fetched = await Promise.all(
    tables.map(async ([table, key]) => {
      const rows: unknown[] = [];
      const name: string = table;
      let columns: string = LEDGER_COLUMNS[table];
      for (let from = 0; ; from += PAGE_SIZE) {
        const page = await supabase
          .from(name)
          .select(columns)
          .eq("user_id", userId)
          .order("id")
          .range(from, from + PAGE_SIZE - 1);
        if (page.error && table === "ledger_obligations" && columns !== LEDGER_OBLIGATION_LEGACY_COLUMNS && page.error.message.includes("origin")) {
          // The origin column arrives with the follow-up migration; read without it until then.
          columns = LEDGER_OBLIGATION_LEGACY_COLUMNS;
          from -= PAGE_SIZE;
          continue;
        }
        if (page.error) {
          if (MISSING_OBJECT_CODES.has(page.error.code ?? "")) return { key, rows, unavailable: true };
          console.error(`Error fetching ${table}:`, page.error.message);
          break;
        }
        rows.push(...(page.data ?? []));
        if ((page.data ?? []).length < PAGE_SIZE) break;
      }
      return { key, rows, unavailable: false };
    })
  );

  if (fetched.some((table) => table.unavailable)) return UNAVAILABLE;
  const result: LedgerServerData = { ...EMPTY_LEDGER_ROWS, available: true };
  for (const { key, rows } of fetched) (result[key] as unknown[]) = rows;
  return result;
}
