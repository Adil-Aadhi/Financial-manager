import React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Standard glass section card with optional header row. */
export function Card({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  description?: string;
  /** Right side of the header, e.g. a "View all" link. */
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("glass glass-edge rounded-2xl", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>}
            {description && <p className="mt-0.5 truncate text-xs text-fg-subtle">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Small accent link used in card headers. */
export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-glass-hover hover:text-accent-strong"
    >
      {children}
    </Link>
  );
}
