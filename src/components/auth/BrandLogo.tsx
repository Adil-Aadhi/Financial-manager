import React from "react";
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

/* Colours come from the accent tokens, so the logo follows the user's theme colour. */
const C = {
  light: "color-mix(in oklab, var(--accent) 55%, white)",
  mid: "var(--accent)",
  deep: "var(--accent-strong)",
  base: "color-mix(in oklab, var(--accent-strong) 62%, black)",
  side: "color-mix(in oklab, var(--accent-strong) 30%, white)",
  shade: "color-mix(in oklab, var(--accent-strong) 70%, black)",
};

// Ascending bars: [x, top] — width 8, baseline y=45, extrusion (+3, -2.5).
const BARS: [number, number][] = [
  [14, 35],
  [26, 28],
  [38, 21],
];
const W = 8;
const BASE = 45;
const DX = 3;
const DY = -2.5;

/**
 * 3D app mark: a glossy raised tile with three extruded growth bars and a rising arrow.
 * Inline SVG with shared gradient ids (identical definitions, so repeats on one page are safe).
 */
export function BrandMark({ size = "md", className }: { size?: BrandLogoProps["size"]; className?: string }) {
  const px = SIZES[size].px;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      style={{ filter: "drop-shadow(0 6px 10px color-mix(in oklab, var(--accent) 40%, transparent))" }}
    >
      <defs>
        <linearGradient id="ftm-face" x1="10" y1="2" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: C.light }} />
          <stop offset="0.45" style={{ stopColor: C.mid }} />
          <stop offset="1" style={{ stopColor: C.deep }} />
        </linearGradient>
        <linearGradient id="ftm-gloss" x1="0" y1="3" x2="0" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ftm-rim" x1="0" y1="3" x2="0" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="ftm-front" x1="0" y1="18" x2="0" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e9eef5" />
        </linearGradient>
        <clipPath id="ftm-clip">
          <rect x="4" y="3" width="56" height="53" rx="15" />
        </clipPath>
        <filter id="ftm-lift" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.3" style={{ floodColor: C.shade }} floodOpacity="0.55" />
        </filter>
      </defs>

      {/* Extruded base (tile thickness) */}
      <rect x="4" y="7" width="56" height="53" rx="15" style={{ fill: C.base }} />
      {/* Tile face */}
      <rect x="4" y="3" width="56" height="53" rx="15" fill="url(#ftm-face)" />
      {/* Glossy top sheen */}
      <g clipPath="url(#ftm-clip)">
        <ellipse cx="26" cy="5" rx="40" ry="22" fill="url(#ftm-gloss)" />
      </g>
      {/* Bevel rim */}
      <rect x="4.5" y="3.5" width="55" height="52" rx="14.5" stroke="url(#ftm-rim)" strokeWidth="1" />

      {/* Bars + arrow, lifted off the face */}
      <g filter="url(#ftm-lift)">
        {BARS.map(([x, top]) => (
          <g key={x}>
            {/* right side */}
            <path
              d={`M${x + W} ${top} L${x + W + DX} ${top + DY} L${x + W + DX} ${BASE + DY} L${x + W} ${BASE} Z`}
              style={{ fill: C.side }}
            />
            {/* top */}
            <path d={`M${x} ${top} L${x + DX} ${top + DY} L${x + W + DX} ${top + DY} L${x + W} ${top} Z`} fill="#fff" />
            {/* front */}
            <rect x={x} y={top} width={W} height={BASE - top} fill="url(#ftm-front)" />
          </g>
        ))}

        {/* Rising arrow: shadow stroke for depth, then the white stroke */}
        <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.4">
          <path d="M12 27 L22 19 L30 22.5 L47 9" transform="translate(0.9 1.4)" style={{ stroke: C.shade }} strokeOpacity="0.5" />
          <path d="M41 9 H47 V15" transform="translate(0.9 1.4)" style={{ stroke: C.shade }} strokeOpacity="0.5" />
          <path d="M12 27 L22 19 L30 22.5 L47 9" stroke="#fff" />
          <path d="M41 9 H47 V15" stroke="#fff" />
        </g>
      </g>
    </svg>
  );
}

export function BrandLogo({ className, size = "md", withLink = true, markOnly = false }: BrandLogoProps) {
  const s = SIZES[size];

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} />
      {!markOnly && (
        <span className={cn("font-semibold tracking-tight text-fg", s.title)}>
          Finance<span className="text-gradient">Tracker</span>
        </span>
      )}
    </span>
  );

  if (!withLink) return content;

  return (
    <Link href="/" aria-label="FinanceTracker home" className="inline-flex rounded-xl transition-opacity hover:opacity-90">
      {content}
    </Link>
  );
}
