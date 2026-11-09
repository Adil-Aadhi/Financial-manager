import { Metadata } from "next";
import { SettingsPageContent } from "@/components/profile/SettingsPageContent";

export const metadata: Metadata = {
  title: "Settings | AccountTracker",
  description: "Profile and preferences.",
};

export default function SettingsPage() {
  return <SettingsPageContent />;
}
