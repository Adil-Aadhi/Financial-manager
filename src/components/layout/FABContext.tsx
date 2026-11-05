"use client";

import React, { createContext, useContext, useState, useMemo } from "react";
import { usePathname } from "next/navigation";
import { AddAccountModal } from "@/components/accounts/AddAccountModal";
import { QuickTransactionModal } from "@/components/transactions/QuickTransactionModal";
import { AddCategoryModal } from "@/components/categories/CategoryModals";

export interface AccountContextData {
  id?: string;
  name: string;
}

interface FABContextType {
  triggerAction: () => void;
  openAddAccount: () => void;
  openAddCategory: () => void;
  openQuickTransaction: (account?: AccountContextData) => void;
  activeAccount: AccountContextData | null;
  setActiveAccount: (account: AccountContextData | null) => void;
  actionType: "quick-transaction" | "add-category";
  fabLabel: string;
  fabTooltip: string;
}

const FABContext = createContext<FABContextType | undefined>(undefined);

export function FABProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [isQuickTransactionOpen, setIsQuickTransactionOpen] = useState(false);
  const [activeAccount, setActiveAccount] = useState<AccountContextData | null>(null);

  // Determine page context dynamically from route or active account
  const isAccountDetailsPage = pathname.startsWith("/accounts/") && pathname !== "/accounts";
  const isTransactionsPage = pathname === "/transactions" || pathname.startsWith("/transactions/");
  const isCategoriesPage = pathname === "/categories" || pathname.startsWith("/categories/");

  const actionType: "quick-transaction" | "add-category" = useMemo(() => {
    if (isCategoriesPage) return "add-category";
    if (isAccountDetailsPage) return "quick-transaction";
    if (isTransactionsPage) return "quick-transaction";
    return "quick-transaction";
  }, [isAccountDetailsPage, isCategoriesPage, isTransactionsPage]);

  const fabLabel = useMemo(() => {
    if (actionType === "add-category") return "Add Category";
    if (actionType === "quick-transaction") return "New Transaction";
    return "New";
  }, [actionType]);

  const fabTooltip = useMemo(() => {
    if (actionType === "add-category") return "Open Add Category modal";
    if (actionType === "quick-transaction") return "Open Add Transaction form";
    return "Action";
  }, [actionType]);

  const triggerAction = () => {
    if (actionType === "add-category") {
      setIsAddCategoryOpen(true);
    } else {
      setIsQuickTransactionOpen(true);
    }
  };

  const openAddAccount = () => setIsAddAccountOpen(true);
  const openAddCategory = () => setIsAddCategoryOpen(true);

  const openQuickTransaction = (account?: AccountContextData) => {
    if (account) setActiveAccount(account);
    setIsQuickTransactionOpen(true);
  };

  return (
    <FABContext.Provider
      value={{
        triggerAction,
        openAddAccount,
        openAddCategory,
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

      <AddCategoryModal
        isOpen={isAddCategoryOpen}
        onClose={() => setIsAddCategoryOpen(false)}
      />

      {isQuickTransactionOpen && (
        <QuickTransactionModal
          isOpen
          onClose={() => setIsQuickTransactionOpen(false)}
          selectedAccount={isAccountDetailsPage ? activeAccount : null}
          lockAccount={isAccountDetailsPage}
        />
      )}
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
