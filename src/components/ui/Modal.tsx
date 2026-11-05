"use client";

import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const emptySubscribe = () => () => {};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  size = "md",
}: ModalProps) {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // Lock body scroll while modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isMounted || !isOpen) return null;

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
  };

  // Mobile: bottom sheet that slides up and respects the home indicator.
  // sm+: centred floating dialog.
  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-canvas/60 backdrop-blur-md transition-opacity duration-200 animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Surface */}
      <div
        ref={panelRef}
        className={cn(
          "glass-strong glass-edge relative z-10 max-h-[92dvh] w-full animate-sheet overflow-y-auto overscroll-contain rounded-t-[28px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-fg shadow-glass",
          "sm:max-h-[calc(100dvh-3rem)] sm:animate-rise sm:rounded-3xl sm:p-7",
          sizeClasses[size],
          className
        )}
      >
        {/* Grabber (mobile only) */}
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3 sm:items-start sm:pb-4">
          <div className="min-w-0">
            <h2
              id="modal-title"
              className="truncate text-base font-semibold tracking-tight text-fg sm:text-xl"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-fg-muted sm:text-sm">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-glass-hover text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div>{children}</div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
