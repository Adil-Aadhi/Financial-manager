import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { BrandLogo } from "@/components/auth/BrandLogo";
import { AuroraBackground } from "@/components/ui/AuroraBackground";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Offline | FinanceTracker",
};

export default function OfflinePage() {
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 text-fg">
      <AuroraBackground />
      <section className="glass-strong glass-edge relative w-full max-w-sm rounded-3xl p-6 text-center sm:p-8">
        <div className="flex justify-center">
          <BrandLogo size="md" />
        </div>
        <span className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/12 text-warning">
          <WifiOff className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-fg">You&apos;re offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Previously opened app pages remain available. Reconnect once to finish preparing offline data.
        </p>
        <Link
          href="/home"
          className={cn(buttonBase, buttonVariants.primary, buttonSizes.lg, "mt-6 w-full")}
        >
          Open FinanceTracker
        </Link>
      </section>
    </main>
  );
}

