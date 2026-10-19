"use client";

import { useEffect, useState } from "react";

/**
 * The height of what is actually visible — the viewport minus the on-screen
 * keyboard — so a full-screen layout can keep its composer above the keyboard
 * on browsers (iOS Safari, Chrome for Android) that leave the layout viewport
 * at full height while the keyboard is up. Null until measured, while there is
 * no `visualViewport`, and while the user is pinch-zoomed (zoom also shrinks
 * the visual viewport, and the layout must not follow it).
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (viewport.scale !== 1) {
        setHeight(null);
        return;
      }
      setHeight(Math.round(viewport.height));
      // iOS scrolls the page to reveal a focused field; the shell never scrolls.
      if (viewport.offsetTop > 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return height;
}
