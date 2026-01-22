"use client";

import { usePathname } from "next/navigation";
import { useFavicon } from "@/hooks/useFavicon";
import { useEffect, useState } from "react";

/**
 * Component to manage favicon restoration when navigating away from workspace pages.
 * This ensures the default favicon is restored when users navigate to non-workspace pages.
 */
export function FaviconManager() {
  const pathname = usePathname();
  const [shouldResetFavicon, setShouldResetFavicon] = useState(false);

  useEffect(() => {
    // Check if we're on a workspace page (starts with /w/)
    const isWorkspacePage = pathname.startsWith('/w/');
    
    // If we're NOT on a workspace page, reset the favicon
    setShouldResetFavicon(!isWorkspacePage);
  }, [pathname]);

  // Reset favicon when not on workspace pages
  useFavicon({ 
    workspaceLogoUrl: null, 
    enabled: shouldResetFavicon 
  });

  // This component doesn't render anything
  return null;
}
