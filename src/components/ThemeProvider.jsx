"use client";

import { useEffect } from "react";

const THEME_STORAGE_KEY = "mindcanvas:theme";
const THEME_EVENT = "mindcanvas:themechange";
const DEFAULT_THEME = "warm-canvas";

// Phase 7B: the legacy multi-theme set (dark-studio, midnight, sepia,
// slate) was retired — only the redesigned light palette ships. Its
// data-theme id stays "warm-canvas" so no CSS variables had to change;
// only the user-facing name is new.
// "Ink" was promoted from placeholder to a real theme: of the three
// proposed palettes it is the only neutral near-black one, so it makes a
// genuinely usable dark mode. Forest (green-tinted) and Dusk (purple) would
// both have been low-contrast mid-tones rather than true dark surfaces.
export const THEMES = [
  { id: "warm-canvas", name: "Matcha", blurb: "Soft paper, sage accent, ink sidebar" },
  { id: "ink", name: "Ink", blurb: "True dark. Near-black surfaces, sage accent" },
];

// Still label-only: no data-theme blocks exist for these.
export const COMING_SOON_THEMES = [
  { id: "forest", name: "Forest" },
  { id: "dusk", name: "Dusk" },
];

// ---------------------------------------------------------------------------
// Font preference — same shape as the theme system, driven by data-font.
// ---------------------------------------------------------------------------
const FONT_STORAGE_KEY = "mindcanvas:font";
const FONT_EVENT = "mindcanvas:fontchange";
const DEFAULT_FONT = "default";

// Only the DISPLAY face changes; Inter remains the UI face throughout.
export const FONTS = [
  { id: "default", name: "Default", blurb: "Instrument Serif + Inter" },
  { id: "modern", name: "Modern", blurb: "Plus Jakarta Sans + Inter" },
  { id: "classic", name: "Classic", blurb: "Playfair Display + Inter" },
];

export function getStoredFont() {
  if (typeof window === "undefined") return DEFAULT_FONT;
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    if (!stored || !FONTS.some((f) => f.id === stored)) return DEFAULT_FONT;
    return stored;
  } catch {
    return DEFAULT_FONT;
  }
}

export function setFont(font) {
  const next = FONTS.some((f) => f.id === font) ? font : DEFAULT_FONT;
  try {
    localStorage.setItem(FONT_STORAGE_KEY, next);
  } catch {
    // localStorage may be blocked — font still applies for this session
  }
  document.documentElement.setAttribute("data-font", next);
  window.dispatchEvent(new CustomEvent(FONT_EVENT, { detail: { font: next } }));
}

export function getStoredTheme() {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    // Devices that selected a now-retired theme must not be left on a
    // data-theme id the UI no longer offers.
    if (!stored || !THEMES.some((t) => t.id === stored)) return DEFAULT_THEME;
    return stored;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setTheme(theme) {
  const next = THEMES.some((t) => t.id === theme) ? theme : DEFAULT_THEME;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // localStorage may be blocked — theme still applies for this session
  }
  document.documentElement.setAttribute("data-theme", next);
  window.dispatchEvent(
    new CustomEvent(THEME_EVENT, { detail: { theme: next } }),
  );
}

export default function ThemeProvider({ children }) {
  useEffect(() => {
    const applyStored = () => {
      document.documentElement.setAttribute("data-theme", getStoredTheme());
      document.documentElement.setAttribute("data-font", getStoredFont());
    };
    applyStored();

    const handleThemeChange = (e) => {
      const theme = e?.detail?.theme || getStoredTheme();
      document.documentElement.setAttribute("data-theme", theme);
    };
    const handleFontChange = (e) => {
      const font = e?.detail?.font || getStoredFont();
      document.documentElement.setAttribute("data-font", font);
    };
    const handleStorage = (e) => {
      if (e.key === THEME_STORAGE_KEY || e.key === FONT_STORAGE_KEY) {
        applyStored();
      }
    };

    window.addEventListener(THEME_EVENT, handleThemeChange);
    window.addEventListener(FONT_EVENT, handleFontChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(THEME_EVENT, handleThemeChange);
      window.removeEventListener(FONT_EVENT, handleFontChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return children;
}
