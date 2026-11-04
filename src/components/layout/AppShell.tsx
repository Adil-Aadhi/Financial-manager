import React from "react";
import Link from "next/link";
import { AuroraBackground } from "@/components/ui/AuroraBackground";
import { AppearanceMenu } from "@/components/theme/AppearanceMenu";
import { BrandLogo } from "@/components/auth/BrandLogo";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { FloatingActionButton } from "@/components/ui/FloatingActionButton";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { TopNav } from "./TopNav";
import { BottomNav } from "./BottomNav";
import { UserAvatar } from "./UserAvatar";
import { FABProvider } from "./FABContext";

interface AppShellProps {
  userName: string;
  userEmail?: string | null;
  currency: SupportedCurrency;
  children: React.ReactNode;
}

/**
 * Signed-in layout: one floating glass navbar at the top + contextual FAB.
 * - lg+: brand · nav links · appearance · avatar · sign out · floating FAB (bottom-right)
 * - < lg: brand · appearance · avatar, plus the tab bar (BottomNav) at the bottom.
 */
export function AppShell({ userName, userEmail, currency, children }: AppShellProps) {
  return (
    <FABProvider>
      <div className="relative isolate min-h-dvh text-fg">
        <AuroraBackground />

        <header className="sticky top-0 z-40 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
          <div className="glass-strong glass-edge mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 rounded-2xl pl-3 pr-2.5 sm:pl-4">
            <BrandLogo size="sm" />

            <TopNav />

            <div className="flex items-center gap-2">
              <AppearanceMenu />
              <Link
                href="/settings"
                aria-label="Profile and settings"
                title={userEmail ? `${userName} · ${userEmail} · ${currency}` : userName}
                className="rounded-full"
              >
                <UserAvatar name={userName} size="sm" />
              </Link>
              <SignOutButton variant="icon" className="hidden lg:flex" />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:pb-12 lg:pt-8">
          {children}
        </main>

        {/* Reusable Floating Action Button: page-aware action */}
        <FloatingActionButton />

        <BottomNav />
      </div>
    </FABProvider>
  );
}

/** Page title row used at the top of every signed-in page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-medium text-fg-subtle">{eyebrow}</p>}
        <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight text-fg sm:text-[28px]">
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
