"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  buildLedgerModel,
  missingRecurringObligations,
  type LedgerModel,
  type LedgerRows,
} from "@/lib/ledger";
import { offlineDb } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/events";
import { generateRecurringDuesLocally } from "@/lib/offline/ledgerMutations";
import { readLedgerRows } from "@/lib/offline/ledgerTables";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { LEDGER_ENTRY_ROUTE, warmLedgerRoutes } from "@/lib/offline/warmRoutes";
import type { LedgerServerData } from "@/lib/supabase/ledger";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { useIndiaToday } from "@/lib/useIndiaToday";
import { LedgerAddHost } from "./LedgerAddHost";

/** What the global add button and every "open" action can show. Modals stack, so closing one returns to the previous. */
export type LedgerModalState =
  | { kind: "chooser" }
  | { kind: "person"; personId?: string }
  | { kind: "personDetails"; personId: string }
  | { kind: "due"; obligationId?: string }
  | { kind: "expense"; expenseId?: string }
  | { kind: "expenseDetails"; expenseId: string }
  | { kind: "group"; groupId?: string }
  | { kind: "groupDetails"; groupId: string }
  | { kind: "member"; groupId: string }
  | { kind: "memberPayment"; memberId: string }
  | { kind: "payment"; obligationId?: string; paymentId?: string }
  | { kind: "obligation"; obligationId: string };

export type LedgerData = LedgerRows & { available: boolean; source: "local" | "server" };

interface LedgerContextValue {
  ownerId: string;
  currency: SupportedCurrency;
  today: string;
  data: LedgerData;
  model: LedgerModel;
  modals: LedgerModalState[];
  open: (modal: LedgerModalState) => void;
  close: () => void;
  closeAll: () => void;
}

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function useLedger() {
  const value = useContext(LedgerContext);
  if (!value) throw new Error("useLedger must be used inside LedgerProvider");
  return value;
}

/**
 * Ledger read model: the device's IndexedDB copy once a complete snapshot exists (so every page
 * works offline and shows pending local changes), otherwise the server-rendered rows.
 */
function useLedgerData(ownerId: string, server: LedgerServerData): LedgerData {
  const latest = [...server.obligations, ...server.payments].reduce((max, row) => ((row.updated_at ?? "") > max ? (row.updated_at ?? "") : max), "");
  const version = [server.available, server.people.length, server.groups.length, server.obligations.length, server.payments.length, latest].join("|");
  useOfflineRefresh(ownerId, version, "the personal ledger");

  const local = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch || meta.ledgerAvailable === undefined) return null;
    return { available: meta.ledgerAvailable, ...(await readLedgerRows(ownerId)) };
  }, [ownerId]);

  return useMemo(() => (local ? { source: "local" as const, ...local } : { source: "server" as const, ...server }), [local, server]);
}

export function LedgerProvider({
  ownerId,
  currency,
  server,
  serverToday,
  children,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  server: LedgerServerData;
  serverToday: string;
  children: React.ReactNode;
}) {
  const data = useLedgerData(ownerId, server);
  const today = useIndiaToday(serverToday);
  const model = useMemo(() => buildLedgerModel(data, today, currency), [data, today, currency]);
  const [modals, setModals] = useState<LedgerModalState[]>([]);

  const open = useCallback((modal: LedgerModalState) => setModals((stack) => [...stack, modal]), []);
  const close = useCallback(() => setModals((stack) => stack.slice(0, -1)), []);
  const closeAll = useCallback(() => setModals([]), []);

  // Once the ledger's data is on this device, store the ledger entry page for offline use (only if
  // the browser doesn't have it yet). Other ledger pages are stored when visited, or when the user
  // shows intent to open them (see LedgerNav). Nothing is warmed at app startup.
  const localReady = data.source === "local" && data.available;
  useEffect(() => {
    if (localReady) void warmLedgerRoutes([LEDGER_ENTRY_ROUTE]);
  }, [localReady]);

  // Recurring dues are created on this device (online or offline), once per member and period, and
  // synced like any other change. The ref keeps one pass at a time; the result of a pass updates
  // `data`, which re-runs this effect and finds nothing left to create.
  const generating = useRef(false);
  useEffect(() => {
    if (data.source !== "local" || !data.available || generating.current) return;
    if (missingRecurringObligations({ ...data, today }).length === 0) return;
    generating.current = true;
    void generateRecurringDuesLocally(ownerId, today)
      .then((created) => {
        if (created > 0) notifyOutboxChanged();
      })
      .catch((error: unknown) => console.warn("Couldn't generate recurring dues:", error instanceof Error ? error.message : error))
      .finally(() => {
        generating.current = false;
      });
  }, [data, today, ownerId]);

  const value = useMemo<LedgerContextValue>(
    () => ({ ownerId, currency, today, data, model, modals, open, close, closeAll }),
    [ownerId, currency, today, data, model, modals, open, close, closeAll]
  );

  return (
    <LedgerContext.Provider value={value}>
      {children}
      <LedgerAddHost />
    </LedgerContext.Provider>
  );
}
