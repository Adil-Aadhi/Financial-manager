import React from "react";
import Link from "next/link";
import { AuroraBackground } from "@/components/ui/AuroraBackground";
import { AppearanceMenu } from "@/components/theme/AppearanceMenu";
import { BrandLogo, BrandMark } from "./BrandLogo";

interface AuthLayoutProps {
  children: React.ReactNode;
  /** Card heading. Omit when the form renders its own per-step heading. */
  title?: string;
  subtitle?: string;
  alternateLink?: {
    text: string;
    label: string;
    href: string;
  };
}

/** Minimal centered glass card on the aurora backdrop. */
export function AuthLayout({ children, title, subtitle, alternateLink }: AuthLayoutProps) {
  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col text-fg">
      <AuroraBackground />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <BrandLogo size="md" />
        <AppearanceMenu />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-2">
        {/* Hero 3D mark */}
        <div className="relative mb-7 animate-rise">
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent)_38%,transparent),transparent_70%)] blur-xl"
          />
          <BrandMark size="xl" className="relative" />
        </div>

        <div className="glass-strong glass-edge w-full max-w-[420px] animate-rise rounded-3xl p-6 [animation-delay:80ms] sm:p-8">
          {title && (
            <div className="mb-6 space-y-1">
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
              {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
            </div>
          )}

          {children}

          {alternateLink && (
            <p className="mt-6 border-t border-line pt-5 text-center text-sm text-fg-muted">
              {alternateLink.text}{" "}
              <Link
                href={alternateLink.href}
                className="font-semibold text-accent underline-offset-4 transition-colors hover:text-accent-strong hover:underline"
              >
                {alternateLink.label}
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
