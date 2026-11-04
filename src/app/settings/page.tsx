import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { ProfileSettingsForm } from "@/components/profile/ProfileSettingsForm";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AccentPicker } from "@/components/theme/AccentPicker";
import { SignOutButton } from "@/components/auth/SignOutButton";

export const instant = false;

export const metadata: Metadata = {
  title: "Settings | FinanceTracker",
  description: "Profile and preferences.",
};

export default async function SettingsPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "User";

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader title="Settings" />

      <div className="max-w-2xl space-y-5">
        <Card title="Profile">
          <ProfileSettingsForm initialProfile={profile} userEmail={user.email || ""} />
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
    </AppShell>
  );
}
