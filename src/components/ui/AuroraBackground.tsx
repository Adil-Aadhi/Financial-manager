import React from "react";

/**
 * Fixed full-viewport ambient backdrop: slow-drifting colour blobs + a faint
 * masked grid. Glass surfaces need something behind them to blur, so every
 * full-page layout (auth, app shell) renders this once.
 */
export function AuroraBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      <div className="absolute -left-[10%] -top-[20%] h-[60vmax] w-[60vmax] animate-aurora rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_65%)] blur-3xl" />
      <div className="absolute -right-[15%] top-[5%] h-[55vmax] w-[55vmax] animate-aurora rounded-full bg-[radial-gradient(circle,var(--aurora-2),transparent_65%)] blur-3xl [animation-delay:-7s]" />
      <div className="absolute -bottom-[30%] left-[25%] h-[50vmax] w-[50vmax] animate-aurora rounded-full bg-[radial-gradient(circle,var(--aurora-3),transparent_65%)] blur-3xl [animation-delay:-14s]" />
      <div
        className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        style={{
          backgroundImage:
            "linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-canvas to-transparent" />
    </div>
  );
}
