import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const targetDate = new Date(date);
  const diffInMs = now.getTime() - targetDate.getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInMinutes < 1) {
    return "just now";
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes === 1 ? "" : "s"} ago`;
  } else if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours === 1 ? "" : "s"} ago`;
  } else if (diffInDays < 7) {
    return `${diffInDays} day${diffInDays === 1 ? "" : "s"} ago`;
  } else {
    return targetDate.toLocaleDateString();
  }
}

export function getBaseUrl(hostHeader?: string | null): string {
  // Use the provided host header, NEXTAUTH_URL, or fallback to localhost
  if (hostHeader) {
    const protocol = hostHeader.includes("localhost") ? "http" : "https";
    return `${protocol}://${hostHeader}`;
  }

  // If NEXTAUTH_URL is provided, use it directly
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }

  // Fallback to localhost
  return "http://localhost:3000";
}

/**
 * Extracts the relative URL (pathname + search + hash) from a full URL
 * and removes workspace prefix (/w/[slug]) to show only the page path
 * Returns "/" if the URL is just a domain without a path
 * Returns the original string if it's already a relative URL or can't be parsed
 */
export function getRelativeUrl(url: string): string {
  if (!url) return "/";

  let pathname: string;
  let search = "";
  let hash = "";

  try {
    // Try to parse as URL
    const urlObj = new URL(url);
    pathname = urlObj.pathname;
    search = urlObj.search;
    hash = urlObj.hash;
  } catch {
    // If parsing fails, it might already be a relative URL
    if (!url.startsWith("/")) {
      return url;
    }
    // Extract parts manually for relative URLs
    const hashIndex = url.indexOf("#");
    const searchIndex = url.indexOf("?");

    if (hashIndex !== -1) {
      pathname = url.substring(0, hashIndex);
      hash = url.substring(hashIndex);
    } else if (searchIndex !== -1) {
      pathname = url.substring(0, searchIndex);
      search = url.substring(searchIndex);
    } else {
      pathname = url;
    }
  }

  // Remove workspace prefix pattern: /w/[slug]/
  // Match /w/ followed by any slug (alphanumeric, hyphens, underscores) followed by /
  const workspacePattern = /^\/w\/[a-zA-Z0-9_-]+/;
  pathname = pathname.replace(workspacePattern, "");

  // If pathname is now empty, default to "/"
  if (!pathname) {
    pathname = "/";
  }

  return pathname + search + hash;
}
