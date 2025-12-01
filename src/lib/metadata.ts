import type { Metadata } from "next";
import { isDevelopmentMode } from "./runtime";

/**
 * Returns dynamic metadata configuration based on the environment.
 * In development mode, uses dev-specific favicons with purple branding.
 * In production mode, uses standard favicons.
 */
export function getMetadata(): Metadata {
  const isDevMode = isDevelopmentMode();
  const faviconPath = isDevMode ? "/dev" : "";
  const manifestPath = isDevMode ? "/dev/dev.webmanifest" : "/site.webmanifest";

  return {
    title: "Hive",
    description: "AI-first PM toolkit",
    icons: {
      icon: [
        { url: `${faviconPath}/favicon-16x16.png`, sizes: "16x16", type: "image/png" },
        { url: `${faviconPath}/favicon-32x32.png`, sizes: "32x32", type: "image/png" },
        { url: `${faviconPath}/favicon.ico`, sizes: "any" },
      ],
      apple: [{ url: `${faviconPath}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
    },
    manifest: manifestPath,
  };
}
