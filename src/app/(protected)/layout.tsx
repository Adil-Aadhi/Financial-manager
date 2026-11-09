import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AuthenticatedAppProvider } from "@/components/auth/AuthenticatedAppProvider";
import { AppShell } from "@/components/layout/AppShell";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";

// Authentication is request-bound. The shared shell persists after entry into this route group,
// while direct visits still verify the session on the server before rendering protected UI.
export const instant = false;

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const userName = profile.full_name || user.email?.split("@")[0] || "User";

  return (
    <AuthenticatedAppProvider
      user={{
        id: user.id,
        email: user.email ?? "",
        profile,
      }}
    >
      <AppShell
        userName={userName}
        userEmail={user.email}
        currency={profile.default_currency}
      >
        {children}
      </AppShell>
    </AuthenticatedAppProvider>
  );
}
