import { useEffect, useState } from 'react';
import { isDevelopmentMode } from '@/lib/runtime';

type OverlayType = 'none' | 'busy' | 'waiting' | 'done';

interface UseFaviconOptions {
  workspaceLogoUrl?: string | null;
  enabled?: boolean;
  /** @deprecated Use overlayType instead. Maps to overlayType: 'busy'. */
  showNotificationDot?: boolean;
  overlayType?: OverlayType;
}

/**
 * Hook to dynamically update the browser favicon based on workspace logo.
 * When a workspace has a custom logo, it replaces the default favicon.
 * When no custom logo is available, it reverts to the default favicon.
 * Optionally adds an overlay badge:
 *   - 'busy'    — yellow dot (same as legacy showNotificationDot)
 *   - 'waiting' — blue circle with white '?' character
 *   - 'done'    — green circle with white '✓' character
 *   - 'none'    — no overlay
 */
export function useFavicon({
  workspaceLogoUrl,
  enabled = true,
  showNotificationDot = false,
  overlayType,
}: UseFaviconOptions) {
  const [isUpdating, setIsUpdating] = useState(false);

  // Resolve effective overlay: explicit overlayType wins; fallback to legacy showNotificationDot
  const effectiveOverlay: OverlayType = overlayType ?? (showNotificationDot ? 'busy' : 'none');

  useEffect(() => {
    if (!enabled) return;

    const updateFavicon = async () => {
      setIsUpdating(true);
      try {
        // Get all favicon link elements
        let faviconLinks = Array.from(
          document.querySelectorAll<HTMLLinkElement>(
            'link[rel*="icon"], link[rel="apple-touch-icon"]'
          )
        );

        // Fallback: if no favicon links found (Next.js App Router timing edge case),
        // create and append one so we always have something to update.
        if (faviconLinks.length === 0) {
          const fallback = document.createElement('link');
          fallback.rel = 'icon';
          fallback.type = 'image/png';
          document.head.appendChild(fallback);
          faviconLinks = [fallback];
        }

        // Local default favicon path — always same-origin, never S3
        const isDevMode = isDevelopmentMode();
        const localDefaultFavicon = `${isDevMode ? '/dev' : ''}/favicon-32x32.png`;

        // Determine the base favicon URL for non-overlay cases
        const baseFaviconUrl = workspaceLogoUrl ?? localDefaultFavicon;

        // Build the final favicon URL
        let finalFaviconUrl: string;

        if (effectiveOverlay !== 'none') {
          // Overlay compositing always uses the local default favicon as base (CORS-safe)
          try {
            finalFaviconUrl = await createFaviconWithBadge(localDefaultFavicon, effectiveOverlay);
          } catch (error) {
            console.error('Failed to create favicon badge overlay:', error);
            finalFaviconUrl = localDefaultFavicon;
          }
        } else if (workspaceLogoUrl) {
          finalFaviconUrl = workspaceLogoUrl;
        } else {
          finalFaviconUrl = localDefaultFavicon;
        }

        // Update all favicon links
        const shouldOverride = !!workspaceLogoUrl || effectiveOverlay !== 'none';

        faviconLinks.forEach((link) => {
          if (shouldOverride) {
            // Store original href before changing it (if not already stored)
            if (!link.dataset.originalHref) {
              link.dataset.originalHref = link.href;
            }
            link.href = finalFaviconUrl;
          } else {
            // Revert to default favicons
            const faviconPath = isDevelopmentMode() ? '/dev' : '';

            if (link.dataset.originalHref) {
              link.href = link.dataset.originalHref;
              delete link.dataset.originalHref;
            } else {
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
  }, [workspaceLogoUrl, enabled, effectiveOverlay]);

  return { isUpdating };
}

/**
 * Draws the appropriate badge onto a 32×32 canvas loaded with the base favicon.
 * The badge is drawn in the top-right corner (x≈22, y≈5, r=5) — same position
 * as the legacy notification dot.
 *
 * Always pass a same-origin `baseIconUrl` to avoid CORS canvas-taint errors.
 */
async function createFaviconWithBadge(
  baseIconUrl: string,
  overlay: 'busy' | 'waiting' | 'done'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    const img = new Image();
    // No crossOrigin attribute needed — base is always same-origin

    img.onload = () => {
      try {
        // Draw base favicon
        ctx.drawImage(img, 0, 0, 32, 32);

        // Badge position (top-right corner)
        const dotX = 22;
        const dotY = 5;
        const dotRadius = 5;

        // Shadow for depth
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        if (overlay === 'busy') {
          // Yellow filled circle — matches legacy notification dot exactly
          ctx.fillStyle = '#FFD700';
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = '#FFA500';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (overlay === 'waiting') {
          // Blue circle with white '?'
          ctx.fillStyle = '#3B82F6';
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 7px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', dotX, dotY + 0.5);
        } else if (overlay === 'done') {
          // Green circle with white '✓'
          ctx.fillStyle = '#22C55E';
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
          ctx.fill();

          ctx.shadowColor = 'transparent';
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 7px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✓', dotX, dotY + 0.5);
        }

        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error(`Failed to load base favicon: ${baseIconUrl}`));
    img.src = baseIconUrl;
  });
}
