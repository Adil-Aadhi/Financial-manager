"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { THEME_STORAGE_KEY } from "./theme-script";
import { ACCENT_STORAGE_KEY, DEFAULT_ACCENT, applyAccent, type AccentValue } from "./accent";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  accent: AccentValue;
  setAccent: (accent: AccentValue) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "system";
}

function readAccentRaw(): string | null {
  try {
    return localStorage.getItem(ACCENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseAccent(raw: string | null): AccentValue {
  if (!raw) return DEFAULT_ACCENT;
  try {
    const a = JSON.parse(raw);
    if (typeof a?.h === "number" && typeof a?.c === "number") return a;
  } catch {}
  return DEFAULT_ACCENT;
}

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

function applyTheme(pref: ThemePreference) {
  const resolved = resolve(pref);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === ACCENT_STORAGE_KEY) listener();
  };
  mql.addEventListener("change", listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    mql.removeEventListener("change", listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => readPreference();
const getServerSnapshot = (): ThemePreference => "system";
const getResolvedSnapshot = () => resolve(readPreference());
const getResolvedServerSnapshot = (): ResolvedTheme => "light";
// Snapshot the raw string (stable identity); parse it with useMemo.
const getAccentSnapshot = () => readAccentRaw();
const getAccentServerSnapshot = () => null;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    getResolvedSnapshot,
    getResolvedServerSnapshot
  );

  const accentRaw = useSyncExternalStore(subscribe, getAccentSnapshot, getAccentServerSnapshot);
  const accent = useMemo(() => parseAccent(accentRaw), [accentRaw]);

  // Re-apply after React's dev Strict Mode remount strips <html> attributes.
  useLayoutEffect(() => {
    applyTheme(readPreference());
    applyAccent(parseAccent(readAccentRaw()));
  }, []);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  // Follow OS changes / other tabs.
  useEffect(() => {
    applyTheme(theme);
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
    applyTheme(next);
    listeners.forEach((l) => l());
  }, []);

  const setAccent = useCallback((next: AccentValue) => {
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, JSON.stringify(next));
    } catch {}
    applyAccent(next);
    listeners.forEach((l) => l());
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
