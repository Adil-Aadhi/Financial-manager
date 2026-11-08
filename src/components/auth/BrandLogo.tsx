import React from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

interface BrandLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  withLink?: boolean;
  /** Hide the wordmark and show only the mark. */
  markOnly?: boolean;
}

const SIZES = {
  sm: { px: 34, title: "text-[15px]" },
  md: { px: 38, title: "text-base" },
  lg: { px: 52, title: "text-xl" },
  /** Hero mark above the auth card. */
  xl: { px: 80, title: "text-2xl" },
};

/** Shared 3D notebook-and-pen brand mark used by navigation and authentication screens. */
export function BrandMark({
  size = "md",
  className,
}: {
  size?: BrandLogoProps["size"];
  className?: string;
}) {
  const px = SIZES[size].px;

  return (
    <Image
      src="/assets/account-tracker-mark-256.webp"
      alt=""
      width={px}
      height={px}
      unoptimized
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
      style={{
        width: px,
        height: px,
        filter: "drop-shadow(0 6px 10px rgb(240 68 36 / 0.28))",
      }}
    />
  );
}

export function BrandLogo({
  className,
  size = "md",
  withLink = true,
  markOnly = false,
}: BrandLogoProps) {
  const s = SIZES[size];

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} />
      {!markOnly && (
        <span className={cn("font-semibold tracking-tight text-fg", s.title)}>
          Account<span className="text-gradient">Tracker</span>
        </span>
      )}
    </span>
  );

  if (!withLink) return content;

  return (
    <Link
      href="/"
      aria-label="AccountTracker home"
      className="inline-flex rounded-xl transition-opacity hover:opacity-90"
    >
      {content}
    </Link>
  );
}
