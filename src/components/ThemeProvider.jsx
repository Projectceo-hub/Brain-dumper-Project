"use client";

import { useEffect } from "react";

const THEME_STORAGE_KEY = "mindcanvas:theme";
const THEME_EVENT = "mindcanvas:themechange";
const DEFAULT_THEME = "warm-canvas";

// Phase 7B: the legacy multi-theme set (dark-studio, midnight, sepia,
// slate) was retired — only the redesigned light palette ships. Its
// data-theme id stays "warm-canvas" so no CSS variables had to change;
// only the user-facing name is new.
export const THEMES = [{ id: "warm-canvas", name: "Matcha" }];

// Rendered as disabled cards in Settings. No data-theme blocks exist for
// these yet — they are label-only placeholders.
export const COMING_SOON_THEMES = [
  { id: "forest", name: "Forest" },
  { id: "ink", name: "Ink" },
  { id: "dusk", name: "Dusk" },
];

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
      const theme = getStoredTheme();
      document.documentElement.setAttribute("data-theme", theme);
    };
    applyStored();

    const handleThemeChange = (e) => {
      const theme = e?.detail?.theme || getStoredTheme();
      document.documentElement.setAttribute("data-theme", theme);
    };

    window.addEventListener(THEME_EVENT, handleThemeChange);
    window.addEventListener("storage", (e) => {
      if (e.key === THEME_STORAGE_KEY) applyStored();
    });

    return () => {
      window.removeEventListener(THEME_EVENT, handleThemeChange);
    };
  }, []);

  return children;
}
