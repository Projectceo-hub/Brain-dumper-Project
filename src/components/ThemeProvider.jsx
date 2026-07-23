"use client";

import { useEffect } from "react";

const THEME_STORAGE_KEY = "mindcanvas:theme";
const THEME_EVENT = "mindcanvas:themechange";
const DEFAULT_THEME = "warm-canvas";

export const THEMES = [
  { id: "warm-canvas", name: "Warm Canvas" },
  { id: "dark-studio", name: "Dark Studio" },
  { id: "midnight", name: "Midnight" },
  { id: "sepia", name: "Sepia" },
  { id: "slate", name: "Slate" },
];

export function getStoredTheme() {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
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
