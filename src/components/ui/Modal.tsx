"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
const MOBILE_MODAL_QUERY = "(max-width: 639px)";
const CLOSE_FALLBACK_MS = 450;
const SNAP_DURATION_MS = 300;

interface DragState {
  pointerId: number;
  startY: number;
  startOffset: number;
  startedAt: number;
  moved: boolean;
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const titleHandleRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(isOpen);
  const onCloseRef = useRef(onClose);
  const isClosingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const savedScrollTopRef = useRef(0);
  const [isPresent, setIsPresent] = useState(isOpen);
  const [isEntering, setIsEntering] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [closeIntent, setCloseIntent] = useState<"notify" | "external" | null>(null);
  const [previousIsOpen, setPreviousIsOpen] = useState(isOpen);
  const [isMobile, setIsMobile] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [minimizedOffset, setMinimizedOffset] = useState(0);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (isOpen !== previousIsOpen) {
    setPreviousIsOpen(isOpen);
    if (isOpen) {
      setIsPresent(true);
      setIsEntering(true);
      setIsClosing(false);
      setCloseIntent(null);
      setIsMinimized(false);
    } else if (isPresent && !isClosing) {
      setIsEntering(false);
      setIsClosing(true);
      setCloseIntent("external");
      setIsDragging(false);
      setDragOffset(null);
    }
  }

  useEffect(() => {
    isOpenRef.current = isOpen;
    onCloseRef.current = onClose;
  }, [isOpen, onClose]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const clearRestoreScrollTimer = useCallback(() => {
    if (restoreScrollTimerRef.current) {
      clearTimeout(restoreScrollTimerRef.current);
      restoreScrollTimerRef.current = null;
    }
  }, []);

  const finishClose = useCallback(() => {
    if (!isClosingRef.current || !closeIntent) return;

    clearCloseTimer();
    isClosingRef.current = false;

    if (closeIntent === "external") {
      setIsClosing(false);
      setCloseIntent(null);
      setIsPresent(false);
      return;
    }

    onCloseRef.current();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (isOpenRef.current) {
        // A guarded onClose callback may intentionally keep the modal open.
        setIsClosing(false);
        setCloseIntent(null);
        setIsEntering(true);
      } else {
        setIsClosing(false);
        setCloseIntent(null);
        setIsPresent(false);
      }
    }, 32);
  }, [clearCloseTimer, closeIntent]);

  const beginRequestedClose = useCallback((preserveDragOffset = false) => {
    if (isClosingRef.current || isClosing) return;

    isClosingRef.current = true;
    dragRef.current = null;
    setIsDragging(false);
    if (!preserveDragOffset) setDragOffset(null);
    setIsEntering(false);
    setIsClosing(true);
    setCloseIntent("notify");
  }, [isClosing]);

  const requestClose = useCallback(() => beginRequestedClose(), [beginRequestedClose]);
  const requestCloseFromDrag = useCallback(() => beginRequestedClose(true), [beginRequestedClose]);

  useEffect(() => {
    if (!isClosing || !closeIntent) {
      isClosingRef.current = false;
      return;
    }

    isClosingRef.current = true;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(finishClose, CLOSE_FALLBACK_MS);
    return clearCloseTimer;
  }, [clearCloseTimer, closeIntent, finishClose, isClosing]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MODAL_QUERY);
    const update = () => {
      const mobile = media.matches;
      setIsMobile(mobile);
      if (!mobile) {
        dragRef.current = null;
        setIsDragging(false);
        setDragOffset(null);
        setIsMinimized(false);
      }
    };

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const measureMinimizedOffset = useCallback(() => {
    const panel = panelRef.current;
    const header = headerRef.current;
    if (!panel || !header) return 0;

    const panelRect = panel.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const visibleHeaderHeight = headerRect.bottom - panelRect.top;
    const nextOffset = Math.max(0, panelRect.height - visibleHeaderHeight);
    setMinimizedOffset(nextOffset);
    return nextOffset;
  }, []);

  useLayoutEffect(() => {
    if (!isPresent || !isMobile) return;

    measureMinimizedOffset();
    const observer = new ResizeObserver(measureMinimizedOffset);
    if (panelRef.current) observer.observe(panelRef.current);
    if (headerRef.current) observer.observe(headerRef.current);
    window.addEventListener("orientationchange", measureMinimizedOffset);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measureMinimizedOffset);
    };
  }, [isMobile, isPresent, measureMinimizedOffset, title, description]);

  const minimize = useCallback(() => {
    if (!isMobile || isClosingRef.current) return;

    const scrollArea = scrollRef.current;
    if (scrollArea) {
      savedScrollTopRef.current = scrollArea.scrollTop;
      scrollArea.scrollTop = 0;
    }
    measureMinimizedOffset();
    setDragOffset(null);
    setIsMinimized(true);
    requestAnimationFrame(() => titleHandleRef.current?.focus({ preventScroll: true }));
  }, [isMobile, measureMinimizedOffset]);

  const expand = useCallback(() => {
    if (!isMobile || isClosingRef.current) return;

    clearRestoreScrollTimer();
    setDragOffset(null);
    setIsMinimized(false);
    restoreScrollTimerRef.current = setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTopRef.current;
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : SNAP_DURATION_MS);
  }, [clearRestoreScrollTimer, isMobile]);

  const handleHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobile || isEntering || isClosingRef.current) return;
    const interactiveTarget = (event.target as HTMLElement).closest("button, a, input, select, textarea, [role='button']");
    if (interactiveTarget && interactiveTarget !== titleHandleRef.current) return;

    const startOffset = isMinimized ? minimizedOffset : 0;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset,
      startedAt: performance.now(),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    setDragOffset(startOffset);
  }, [isEntering, isMinimized, isMobile, minimizedOffset]);

  const handleHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const delta = event.clientY - drag.startY;
    if (Math.abs(delta) > 4) drag.moved = true;
    const maximumOffset = isMinimized
      ? panelRef.current?.offsetHeight ?? minimizedOffset
      : minimizedOffset;
    const nextOffset = Math.min(maximumOffset, Math.max(0, drag.startOffset + delta));
    setDragOffset(nextOffset);
  }, [isMinimized, minimizedOffset]);

  const finishHeaderDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsDragging(false);

    if (cancelled) {
      setDragOffset(null);
      return;
    }

    const delta = event.clientY - drag.startY;
    const elapsed = Math.max(performance.now() - drag.startedAt, 1);
    const velocity = delta / elapsed;
    const maximumOffset = isMinimized
      ? panelRef.current?.offsetHeight ?? minimizedOffset
      : minimizedOffset;
    const currentOffset = Math.min(maximumOffset, Math.max(0, drag.startOffset + delta));

    if (isMinimized) {
      if (delta > 32 || velocity > 0.4 || currentOffset > minimizedOffset + 20) {
        setDragOffset(currentOffset);
        requestCloseFromDrag();
        return;
      }
      if (!drag.moved || delta < -48 || velocity < -0.45 || currentOffset < minimizedOffset * 0.65) {
        expand();
      } else {
        setDragOffset(null);
      }
      return;
    }

    if (delta > 64 || velocity > 0.45 || currentOffset > minimizedOffset * 0.25) {
      minimize();
    } else {
      setDragOffset(null);
    }
  }, [expand, isMinimized, minimize, minimizedOffset, requestCloseFromDrag]);

  useEffect(() => {
    if (!isPresent) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose();
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
  }, [isPresent, requestClose]);

  useEffect(() => () => {
    clearCloseTimer();
    clearRestoreScrollTimer();
  }, [clearCloseTimer, clearRestoreScrollTimer]);

  if (!isMounted || !isPresent) return null;

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
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6",
        isClosing && "pointer-events-none"
      )}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-canvas/60 backdrop-blur-md",
          isClosing ? "animate-fade-out" : "animate-fade"
        )}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Modal Surface */}
      <div
        ref={panelRef}
        onAnimationEnd={(event) => {
          if (event.currentTarget !== event.target) return;
          if (isClosingRef.current) finishClose();
          else setIsEntering(false);
        }}
        style={
          isMobile && (dragOffset !== null || isMinimized)
            ? { transform: `translate3d(0, ${dragOffset ?? minimizedOffset}px, 0)` }
            : undefined
        }
        className={cn(
          "glass-strong glass-edge relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-[28px] text-fg shadow-glass",
          "sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl",
          isEntering && "animate-sheet sm:animate-rise",
          isClosing && "animate-sheet-out sm:animate-fall",
          !isEntering && !isClosing && !isDragging && "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          sizeClasses[size],
          className
        )}
      >
        <div
          ref={scrollRef}
          className={cn(
            "min-h-0 overscroll-contain rounded-[inherit] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:overflow-y-auto sm:p-7",
            isMinimized ? "overflow-hidden" : "overflow-y-auto"
          )}
        >
          {/* Grabber (mobile only) */}
          <div
            className={cn(
              "mx-auto mb-2 h-1 rounded-full transition-[width,background-color] duration-200 sm:hidden",
              isMinimized ? "w-12 bg-accent" : "w-9 bg-line-strong"
            )}
            aria-hidden="true"
          />

          {/* Header */}
          <div
            ref={headerRef}
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={(event) => finishHeaderDrag(event)}
            onPointerCancel={(event) => finishHeaderDrag(event, true)}
            className="flex touch-none select-none items-center justify-between gap-3 pb-3 sm:touch-auto sm:select-text sm:items-start sm:pb-4"
          >
            <div
              ref={titleHandleRef}
              role={isMobile && isMinimized ? "button" : undefined}
              tabIndex={isMobile && isMinimized ? 0 : -1}
              aria-expanded={isMobile ? !isMinimized : undefined}
              aria-label={isMobile && isMinimized ? `Expand ${title}` : undefined}
              onKeyDown={(event) => {
                if (isMobile && isMinimized && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  expand();
                }
              }}
              className="min-w-0 flex-1"
            >
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
              onPointerDown={(event) => event.stopPropagation()}
              onClick={requestClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-glass-hover text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div aria-hidden={isMinimized || undefined} inert={isMinimized || undefined}>{children}</div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
