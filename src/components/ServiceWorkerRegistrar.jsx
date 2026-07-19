"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on mount. Renders nothing visible — purely a side-effect
 * component mounted once at the root layout level.
 *
 * In development, the service worker is intentionally NOT registered: the SW
 * caches chunks andNext's hot-reload chunks change constantly, so caching
 * them would break dev. The check is `process.env.NODE_ENV === "production"`.
 *
 * On unmount we don't unregister — the SW is meant to persist. Future
 * updates ship via CACHE_VERSION bump in sw.js, which triggers an
 * install/activate cycle automatically.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Silently log — SW failure should never break the app
          console.warn("Service worker registration failed:", err);
        });
    };

    // Register on next tick so it doesn't block initial paint.
    const id = window.setTimeout(register, 1000);

    return () => window.clearTimeout(id);
  }, []);

  return null;
}
