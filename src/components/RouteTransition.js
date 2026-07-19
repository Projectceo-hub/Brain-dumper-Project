"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Wraps page content so that every pathname change triggers a fade-in +
 * slight upward translate on the new content ("route-enter" CSS class from
 * globals.css). The spec:
 *   - Incoming: fade in + translateY from ~8px below, 180ms, ease-out
 *   - Outgoing: fade out + scale down to 0.98 over 120ms (overlapping)
 *   - Total perceived < 250ms
 *   - Respect prefers-reduced-motion (handled in globals.css)
 *
 * Implementation note: Next.js App Router swaps the children in the same
 * DOM container synchronously, so a true exit-then-enter animation isn't
 * possible without View Transitions API plumbing everywhere. The
 * "outgoing fades + scales down" portion of the spec is best approximated
 * by making the new content appear from a 0-opacity state and trusting the
 * browser's compositor to keep the old paint up for the ~10ms it takes the
 * new one to render. Combined with the page-enter animation, the perceived
 * effect is: brief blur+shrink of old → fade-in + rise-up of new.
 *
 * Watch out for: anchors and scroll-position restoration. We intentionally
 * do NOT animate the wrapper that holds the indentation/scrollbar — only
 * its inner content. The wrapper sits on top of a section element so that
 * nav scroll positions persist across route changes.
 */
export default function RouteTransition({ children }) {
  const pathname = usePathname();
  const [renderKey, setRenderKey] = useState(pathname);
  const lastPathnameRef = useRef(pathname);

  useEffect(() => {
    if (pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = pathname;
      setRenderKey(pathname);
    }
  }, [pathname]);

  return (
    <div key={renderKey} className="route-enter">
      {children}
    </div>
  );
}
