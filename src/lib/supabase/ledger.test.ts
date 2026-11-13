import { afterEach, describe, expect, it, vi } from "vitest";
import { LEDGER_OBLIGATION_LEGACY_COLUMNS } from "@/lib/ledger";
import { getLedgerServerData } from "./ledger";

type Page = { data: unknown[] | null; error: { code?: string; message: string } | null };
const USER = "11111111-1111-4111-8111-111111111111";
const TABLES = ["ledger_people", "ledger_groups", "ledger_members", "ledger_member_rates", "ledger_member_spans", "ledger_expenses", "ledger_obligations", "ledger_payments"];

/**
 * A stand-in for the Supabase client that records every query. `respond` decides each page; a query
 * only resolves after `gate` (if given), which lets a test hold all queries open at once.
 */
function fakeClient(respond: (table: string, columns: string, from: number) => Page, gate?: Promise<void>) {
  const log: Array<{ table: string; columns: string; userId: unknown; from: number }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const client = {
    from(table: string) {
      let columns = "";
      let userId: unknown;
      const builder = {
        select(value: string) { columns = value; return builder; },
        eq(column: string, value: unknown) { if (column === "user_id") userId = value; return builder; },
        order() { return builder; },
        range(from: number) {
          log.push({ table, columns, userId, from });
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          return (async () => {
            if (gate) await gate;
            inFlight -= 1;
            return respond(table, columns, from);
          })();
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as Parameters<typeof getLedgerServerData>[0], log, maxInFlight: () => maxInFlight };
}

const rowsFor = (table: string, count = 1) => Array.from({ length: count }, (_, index) => ({ id: `${table}-${index}`, user_id: USER }));

afterEach(() => vi.restoreAllMocks());

describe("getLedgerServerData", () => {
  it("starts all eight independent table reads at the same time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { client, log, maxInFlight } = fakeClient((table) => ({ data: rowsFor(table), error: null }), gate);
    const pending = getLedgerServerData(client, USER);
    await Promise.resolve();
    await Promise.resolve();
    // None has finished, yet every table's first query is already in flight: no table waits for another.
    expect(log.map((entry) => entry.table).sort()).toEqual([...TABLES].sort());
    expect(maxInFlight()).toBe(TABLES.length);
    release();
    expect((await pending).available).toBe(true);
  });

  it("returns every table's rows in the right place and filters every query by the signed-in user", async () => {
    const { client, log } = fakeClient((table) => ({ data: rowsFor(table, 2), error: null }));
    const data = await getLedgerServerData(client, USER);
    expect(data.available).toBe(true);
    expect(data.people).toHaveLength(2);
    expect(data.payments).toHaveLength(2);
    expect(data.obligations.map((row) => (row as { id: string }).id)).toEqual(["ledger_obligations-0", "ledger_obligations-1"]);
    expect(log).toHaveLength(TABLES.length);
    expect(log.every((entry) => entry.userId === USER)).toBe(true);
  });

  it("still reads a table's own pages one after another, and makes no repeated requests otherwise", async () => {
    const { client, log } = fakeClient((table, _columns, from) => {
      if (table !== "ledger_payments") return { data: [], error: null };
      return { data: from === 0 ? rowsFor("p", 1000) : rowsFor("q", 3), error: null };
    });
    const data = await getLedgerServerData(client, USER);
    expect(data.payments).toHaveLength(1003);
    const paymentQueries = log.filter((entry) => entry.table === "ledger_payments").map((entry) => entry.from);
    expect(paymentQueries).toEqual([0, 1000]);
    // One query per other table: nothing is requested twice.
    expect(log).toHaveLength(TABLES.length + 1);
  });

  it("reports the ledger as unavailable, with no rows, when any table doesn't exist yet", async () => {
    const { client } = fakeClient((table) =>
      table === "ledger_members"
        ? { data: null, error: { code: "PGRST205", message: "Could not find the table" } }
        : { data: rowsFor(table), error: null }
    );
    const data = await getLedgerServerData(client, USER);
    expect(data.available).toBe(false);
    expect(data.people).toEqual([]);
    expect(data.payments).toEqual([]);
  });

  it("logs another kind of error and keeps the rows read so far, as before", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient((table) =>
      table === "ledger_expenses" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: rowsFor(table), error: null }
    );
    const data = await getLedgerServerData(client, USER);
    expect(data.available).toBe(true);
    expect(data.expenses).toEqual([]);
    expect(data.people).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith("Error fetching ledger_expenses:", "boom");
  });

  it("falls back to reading dues without the origin column until that migration is applied", async () => {
    const { client, log } = fakeClient((table, columns) =>
      table === "ledger_obligations" && columns.includes("origin")
        ? { data: null, error: { code: "42703", message: "column ledger_obligations.origin does not exist" } }
        : { data: rowsFor(table), error: null }
    );
    const data = await getLedgerServerData(client, USER);
    expect(data.available).toBe(true);
    expect(data.obligations).toHaveLength(1);
    const dueQueries = log.filter((entry) => entry.table === "ledger_obligations");
    expect(dueQueries.map((entry) => entry.columns === LEDGER_OBLIGATION_LEGACY_COLUMNS)).toEqual([false, true]);
  });

  it("lets a thrown error (for example the network) reach the caller instead of returning partial data", async () => {
    const client = {
      from: () => {
        const builder = { select: () => builder, eq: () => builder, order: () => builder, range: () => Promise.reject(new Error("network down")) };
        return builder;
      },
    } as unknown as Parameters<typeof getLedgerServerData>[0];
    await expect(getLedgerServerData(client, USER)).rejects.toThrow("network down");
  });
});
