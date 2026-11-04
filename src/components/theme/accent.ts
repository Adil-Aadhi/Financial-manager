export const ACCENT_STORAGE_KEY = "ft-accent";

export interface AccentValue {
  /** Preset id, or "custom" for a user-picked colour. */
  id: string;
  /** OKLCH hue (0-360) and chroma (0-0.37). Every accent shade is derived from these. */
  h: number;
  c: number;
  /** Original hex for custom colours (shown in the picker). */
  hex?: string;
}

export interface AccentPreset extends AccentValue {
  name: string;
  /** Swatch colour shown in the picker. */
  swatch: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "emerald", name: "Emerald", h: 163, c: 0.14, swatch: "#10b981" },
  { id: "purple", name: "Purple", h: 300, c: 0.2, swatch: "#a855f7" },
  { id: "orange", name: "Orange", h: 48, c: 0.17, swatch: "#f97316" },
  { id: "red", name: "Red", h: 25, c: 0.19, swatch: "#ef4444" },
  { id: "blue", name: "Blue", h: 260, c: 0.17, swatch: "#3b82f6" },
  { id: "pink", name: "Pink", h: 355, c: 0.18, swatch: "#ec4899" },
];

export const DEFAULT_ACCENT: AccentValue = ACCENT_PRESETS[0];

/** Convert a #rrggbb colour to OKLCH hue + chroma (lightness is fixed per theme). */
export function hexToAccent(hex: string): AccentValue {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;

  // Clamp chroma so very saturated picks stay legible and greys stay usable.
  return { id: "custom", h: Math.round(h), c: Math.min(Math.max(+c.toFixed(3), 0.02), 0.2), hex };
}

export function applyAccent(accent: AccentValue) {
  const root = document.documentElement;
  root.style.setProperty("--accent-h", String(accent.h));
  root.style.setProperty("--accent-c", String(accent.c));
}

/** Inline, dependency-free: apply the stored accent before first paint. */
export const accentInitScript = `(function(){try{var a=JSON.parse(localStorage.getItem("${ACCENT_STORAGE_KEY}")||"null");if(a&&typeof a.h==="number"&&typeof a.c==="number"){var r=document.documentElement.style;r.setProperty("--accent-h",a.h);r.setProperty("--accent-c",a.c)}}catch(e){}})()`;
