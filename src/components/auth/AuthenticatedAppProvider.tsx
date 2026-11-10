"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Profile } from "@/lib/supabase/profile";

export interface AuthenticatedAppUser {
  id: string;
  email: string;
  profile: Profile;
}

const AuthenticatedAppContext = createContext<AuthenticatedAppUser | null>(null);

export function AuthenticatedAppProvider({
  user,
  children,
}: {
  user: AuthenticatedAppUser;
  children: ReactNode;
}) {
  return (
    <AuthenticatedAppContext.Provider value={user}>
      {children}
    </AuthenticatedAppContext.Provider>
  );
}

export function useAuthenticatedApp() {
  const value = useContext(AuthenticatedAppContext);
  if (!value) {
    throw new Error("useAuthenticatedApp must be used within AuthenticatedAppProvider");
  }
  return value;
}
