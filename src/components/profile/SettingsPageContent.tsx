"use client";

import { useAuthenticatedApp } from "@/components/auth/AuthenticatedAppProvider";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { PageHeader } from "@/components/layout/AppShell";
import { OfflineProfileSettingsForm } from "@/components/profile/OfflineProfileSettingsForm";
import { AccentPicker } from "@/components/theme/AccentPicker";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Card } from "@/components/ui/Card";

export function SettingsPageContent() {
  const { id: ownerId, email, profile } = useAuthenticatedApp();

  return (
    <>
      <PageHeader title="Settings" />

      <div className="max-w-2xl space-y-5">
        <Card title="Profile">
          <OfflineProfileSettingsForm
            ownerId={ownerId}
            serverProfile={profile}
            userEmail={email}
          />
        </Card>

        <Card title="Appearance">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-fg-muted">Mode</span>
              <ThemeToggle />
            </div>
            <div className="space-y-2.5">
              <span className="text-sm text-fg-muted">Colour</span>
              <AccentPicker />
            </div>
          </div>
        </Card>

        <section className="glass glass-edge rounded-2xl p-2">
          <SignOutButton />
        </section>
      </div>
    </>
  );
}
