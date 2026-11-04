"use client";

import { useEffect } from "react";
import { useFAB, type AccountContextData } from "@/components/layout/FABContext";

export function AccountFABRegistrar({ account }: { account: AccountContextData }) {
  const { setActiveAccount } = useFAB();

  useEffect(() => {
    setActiveAccount(account);
    return () => {
      setActiveAccount(null);
    };
  }, [account, setActiveAccount]);

  return null;
}
