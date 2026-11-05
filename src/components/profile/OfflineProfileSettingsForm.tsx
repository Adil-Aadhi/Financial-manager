"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ProfileSettingsForm } from "@/components/profile/ProfileSettingsForm";
import { ensureOfflineBootstrap } from "@/lib/offline/bootstrap";
import { offlineDb } from "@/lib/offline/db";
import type { Profile, SupportedCurrency } from "@/lib/supabase/profile";

const SUPPORTED_CURRENCIES = new Set<SupportedCurrency>(["INR", "USD", "AED"]);

export function OfflineProfileSettingsForm({
  ownerId,
  serverProfile,
  userEmail,
}: {
  ownerId: string;
  serverProfile: Profile;
  userEmail: string;
}) {
  const serverVersion = `${serverProfile.full_name}:${serverProfile.default_currency}:${serverProfile.updated_at ?? ""}`;

  useEffect(() => {
    if (!navigator.onLine) return;
    void ensureOfflineBootstrap(ownerId, true).catch((error: unknown) => {
      console.warn(
        "Unable to refresh the offline profile:",
        error instanceof Error ? error.message : error
      );
    });
  }, [ownerId, serverVersion]);

  const localProfile = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;
    const profile = await offlineDb.profiles.get(ownerId);
    if (!profile) return null;

    const currency = profile.default_currency as SupportedCurrency;
    return {
      id: profile.id,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      default_currency: SUPPORTED_CURRENCIES.has(currency) ? currency : "USD",
      created_at: profile.created_at ?? undefined,
      updated_at: profile.updated_at ?? undefined,
    } satisfies Profile;
  }, [ownerId]);

  const profile = localProfile ?? serverProfile;
  const profileKey = `${profile.id}:${profile.full_name}:${profile.default_currency}:${profile.updated_at ?? ""}`;

  return (
    <ProfileSettingsForm
      key={profileKey}
      initialProfile={profile}
      userEmail={userEmail}
    />
  );
}
