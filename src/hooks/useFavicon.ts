import { useEffect, useState } from 'react';
import { isDevelopmentMode } from '@/lib/runtime';

interface UseFaviconOptions {
  workspaceLogoUrl?: string | null;
  enabled?: boolean;
  showNotificationDot?: boolean;
}

/**
 * Hook to dynamically update the browser favicon based on workspace logo.
 * When a workspace has a custom logo, it replaces the default favicon.
 * When no custom logo is available, it reverts to the default favicon.
 * Optionally adds a yellow notification dot overlay when showNotificationDot is true.
 */
export function useFavicon({ workspaceLogoUrl, enabled = true, showNotificationDot = false }: UseFaviconOptions) {
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

        // Determine the base favicon URL
        let baseFaviconUrl: string;
        if (workspaceLogoUrl) {
          baseFaviconUrl = workspaceLogoUrl;
        } else {
          const isDevMode = isDevelopmentMode();
          const faviconPath = isDevMode ? '/dev' : '';
          baseFaviconUrl = `${faviconPath}/favicon-32x32.png`;
        }

        // If notification dot is needed, create canvas overlay
        let finalFaviconUrl = baseFaviconUrl;
        if (showNotificationDot) {
          try {
            finalFaviconUrl = await createFaviconWithNotificationDot(baseFaviconUrl);
          } catch (error) {
            console.error('Failed to create notification dot overlay:', error);
            // Fall back to base favicon without dot
            finalFaviconUrl = baseFaviconUrl;
          }
        }

        // Update all favicon links
        faviconLinks.forEach((link) => {
          if (workspaceLogoUrl || showNotificationDot) {
            // Store original href before changing it (if not already stored)
            if (!link.dataset.originalHref) {
              link.dataset.originalHref = link.href;
            }
            // Update to workspace logo or notification version
            link.href = finalFaviconUrl;
          } else {
            // Revert to default favicons
            const isDevMode = isDevelopmentMode();
            const faviconPath = isDevMode ? '/dev' : '';

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
          }
        });
      } catch (error) {
        console.error('Failed to update favicon:', error);
      } finally {
        setIsUpdating(false);
      }
    };

    updateFavicon();
  }, [workspaceLogoUrl, enabled, showNotificationDot]);

  return { isUpdating };
}

/**
 * Creates a favicon with a yellow notification dot overlay
 * @param baseIconUrl - The base favicon URL to overlay the dot on
 * @returns Data URL of the canvas with notification dot
 */
async function createFaviconWithNotificationDot(baseIconUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    // Set canvas size
    canvas.width = 32;
    canvas.height = 32;

    // Load the base favicon image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        // Draw the base favicon
        ctx.drawImage(img, 0, 0, 32, 32);

        // Draw notification dot at top-right corner
        // Yellow dot with slight shadow for better visibility
        const dotX = 22;
        const dotY = 5;
        const dotRadius = 5;

        // Draw shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        // Draw dot
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.fill();

        // Draw border for better visibility
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#FFA500';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.stroke();

        // Convert canvas to data URL
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load base favicon image'));
    };

    // Handle data URLs and regular URLs
    img.src = baseIconUrl;
  });
}
