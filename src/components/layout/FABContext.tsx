"use client";

import React, { createContext, useContext, useState, useMemo } from "react";
import { usePathname } from "next/navigation";
import { AddAccountModal } from "@/components/accounts/AddAccountModal";
import { QuickTransactionModal } from "@/components/transactions/QuickTransactionModal";

export interface AccountContextData {
  id?: string;
  name: string;
}

interface FABContextType {
  triggerAction: () => void;
  openAddAccount: () => void;
  openQuickTransaction: (account?: AccountContextData) => void;
  activeAccount: AccountContextData | null;
  setActiveAccount: (account: AccountContextData | null) => void;
  actionType: "add-account" | "quick-transaction";
  fabLabel: string;
  fabTooltip: string;
}

const FABContext = createContext<FABContextType | undefined>(undefined);

export function FABProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isQuickTransactionOpen, setIsQuickTransactionOpen] = useState(false);
  const [activeAccount, setActiveAccount] = useState<AccountContextData | null>(null);

  // Determine page context dynamically from route or active account
  const isAccountDetailsPage = pathname.startsWith("/accounts/") && pathname !== "/accounts";
  const isTransactionsPage = pathname === "/transactions" || pathname.startsWith("/transactions/");

  const actionType: "add-account" | "quick-transaction" = useMemo(() => {
    if (isAccountDetailsPage) return "quick-transaction";
    if (isTransactionsPage) return "add-account";
    // Default fallback
    return activeAccount ? "quick-transaction" : "add-account";
  }, [isAccountDetailsPage, isTransactionsPage, activeAccount]);

  const fabLabel = useMemo(() => {
    if (actionType === "add-account") return "Add Account";
    if (actionType === "quick-transaction") return "New Transaction";
    return "New";
  }, [actionType]);

  const fabTooltip = useMemo(() => {
    if (actionType === "add-account") return "Open Add Account modal";
    if (actionType === "quick-transaction") return "Open Quick Transaction Entry";
    return "Action";
  }, [actionType]);

  const triggerAction = () => {
    if (actionType === "add-account") {
      setIsAddAccountOpen(true);
    } else {
      setIsQuickTransactionOpen(true);
    }
  };

  const openAddAccount = () => setIsAddAccountOpen(true);

  const openQuickTransaction = (account?: AccountContextData) => {
    if (account) setActiveAccount(account);
    setIsQuickTransactionOpen(true);
  };

  return (
    <FABContext.Provider
      value={{
        triggerAction,
        openAddAccount,
        openQuickTransaction,
        activeAccount,
        setActiveAccount,
        actionType,
        fabLabel,
        fabTooltip,
      }}
    >
      {children}

      {/* Page-specific Modals managed centrally */}
      <AddAccountModal
        isOpen={isAddAccountOpen}
        onClose={() => setIsAddAccountOpen(false)}
      />

      <QuickTransactionModal
        isOpen={isQuickTransactionOpen}
        onClose={() => setIsQuickTransactionOpen(false)}
        selectedAccount={activeAccount}
      />
    </FABContext.Provider>
  );
}

export function useFAB() {
  const context = useContext(FABContext);
  if (!context) {
    throw new Error("useFAB must be used within a FABProvider");
  }
  return context;
}
