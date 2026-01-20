import { useEffect, useCallback } from 'react';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { FEATURE_FLAGS } from '@/lib/feature-flags';
import { isDevelopmentMode } from '@/lib/runtime';

/**
 * Hook to dynamically update the browser favicon based on workspace logo
 * Falls back to default Hive favicon when no custom logo is available
 */
export function useWorkspaceFavicon(workspaceSlug: string | null, logoKey: string | null | undefined) {
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  // Helper to get default favicon paths
  const getDefaultFaviconPaths = useCallback(() => {
    const isDevMode = isDevelopmentMode();
    const faviconPath = isDevMode ? '/dev' : '';
    return {
      icon16: `${faviconPath}/favicon-16x16.png`,
      icon32: `${faviconPath}/favicon-32x32.png`,
      iconIco: `${faviconPath}/favicon.ico`,
      appleIcon: `${faviconPath}/apple-touch-icon.png`,
    };
  }, []);

  // Helper to update favicon links in the document head
  const updateFaviconLinks = useCallback((iconUrl: string) => {
    // Remove existing favicon links
    const existingIcons = document.querySelectorAll('link[rel*="icon"]');
    existingIcons.forEach((icon) => icon.remove());

    // Add new favicon link for the workspace logo
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = iconUrl;
    document.head.appendChild(link);

    // Also add as shortcut icon for broader browser support
    const shortcutLink = document.createElement('link');
    shortcutLink.rel = 'shortcut icon';
    shortcutLink.href = iconUrl;
    document.head.appendChild(shortcutLink);

    // Add apple-touch-icon for iOS/Safari
    const appleLink = document.createElement('link');
    appleLink.rel = 'apple-touch-icon';
    appleLink.href = iconUrl;
    document.head.appendChild(appleLink);
  }, []);

  // Helper to restore default favicons
  const restoreDefaultFavicons = useCallback(() => {
    const defaults = getDefaultFaviconPaths();

    // Remove existing favicon links
    const existingIcons = document.querySelectorAll('link[rel*="icon"]');
    existingIcons.forEach((icon) => icon.remove());

    // Add default favicon links back
    const icon16 = document.createElement('link');
    icon16.rel = 'icon';
    icon16.type = 'image/png';
    icon16.sizes = '16x16';
    icon16.href = defaults.icon16;
    document.head.appendChild(icon16);

    const icon32 = document.createElement('link');
    icon32.rel = 'icon';
    icon32.type = 'image/png';
    icon32.sizes = '32x32';
    icon32.href = defaults.icon32;
    document.head.appendChild(icon32);

    const iconIco = document.createElement('link');
    iconIco.rel = 'icon';
    iconIco.href = defaults.iconIco;
    document.head.appendChild(iconIco);

    const appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.sizes = '180x180';
    appleIcon.type = 'image/png';
    appleIcon.href = defaults.appleIcon;
    document.head.appendChild(appleIcon);
  }, [getDefaultFaviconPaths]);

  useEffect(() => {
    // Only proceed if feature flag is enabled and we're in a browser environment
    if (!canAccessWorkspaceLogo || typeof window === 'undefined') {
      return;
    }

    // If workspace has a logo, fetch and set it as favicon
    if (workspaceSlug && logoKey) {
      const fetchAndSetFavicon = async () => {
        try {
          const response = await fetch(`/api/workspaces/${workspaceSlug}/image`);
          if (response.ok) {
            const data = await response.json();
            if (data.presignedUrl) {
              updateFaviconLinks(data.presignedUrl);
            } else {
              restoreDefaultFavicons();
            }
          } else {
            // If fetch fails, restore default
            restoreDefaultFavicons();
          }
        } catch (error) {
          console.error('Error fetching workspace logo for favicon:', error);
          restoreDefaultFavicons();
        }
      };

      fetchAndSetFavicon();
    } else {
      // No workspace logo, restore default favicon
      restoreDefaultFavicons();
    }

    // Cleanup function to restore default favicon when component unmounts
    return () => {
      if (typeof window !== 'undefined') {
        restoreDefaultFavicons();
      }
    };
  }, [
    workspaceSlug,
    logoKey,
    canAccessWorkspaceLogo,
    updateFaviconLinks,
    restoreDefaultFavicons,
  ]);
}
