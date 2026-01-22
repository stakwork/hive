import { useEffect, useState } from 'react';
import { isDevelopmentMode } from '@/lib/runtime';

interface UseFaviconOptions {
  workspaceLogoUrl?: string | null;
  enabled?: boolean;
}

/**
 * Hook to dynamically update the browser favicon based on workspace logo.
 * When a workspace has a custom logo, it replaces the default favicon.
 * When no custom logo is available, it reverts to the default favicon.
 */
export function useFavicon({ workspaceLogoUrl, enabled = true }: UseFaviconOptions) {
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const updateFavicon = async () => {
      setIsUpdating(true);
      try {
        // Get all favicon link elements
        const faviconLinks = document.querySelectorAll<HTMLLinkElement>(
          'link[rel*="icon"], link[rel="apple-touch-icon"]'
        );

        if (workspaceLogoUrl) {
          // Update all favicon links to use the workspace logo
          faviconLinks.forEach((link) => {
            // Store original href if not already stored
            if (!link.dataset.originalHref) {
              link.dataset.originalHref = link.href;
            }
            
            // Update to workspace logo
            link.href = workspaceLogoUrl;
          });
        } else {
          // Revert to default favicons
          const isDevMode = isDevelopmentMode();
          const faviconPath = isDevMode ? '/dev' : '';

          faviconLinks.forEach((link) => {
            // If we have stored original href, use it
            if (link.dataset.originalHref) {
              link.href = link.dataset.originalHref;
              delete link.dataset.originalHref;
            } else {
              // Otherwise reconstruct the default path
              const rel = link.rel;
              if (rel === 'apple-touch-icon') {
                link.href = `${faviconPath}/apple-touch-icon.png`;
              } else if (link.sizes) {
                const size = link.sizes.toString();
                if (size === '16x16') {
                  link.href = `${faviconPath}/favicon-16x16.png`;
                } else if (size === '32x32') {
                  link.href = `${faviconPath}/favicon-32x32.png`;
                }
              } else {
                // Default favicon.ico
                link.href = `${faviconPath}/favicon.ico`;
              }
            }
          });
        }
      } catch (error) {
        console.error('Failed to update favicon:', error);
      } finally {
        setIsUpdating(false);
      }
    };

    updateFavicon();
  }, [workspaceLogoUrl, enabled]);

  return { isUpdating };
}
