"use client";

import Link from "next/link";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ReactNode } from "react";

interface WorkspaceLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
}

/**
 * WorkspaceLink - Automatically corrects URLs to include workspace context
 *
 * This component wraps Next.js Link and ensures all internal URLs are properly
 * scoped to the current workspace context. It handles legacy URLs and provides
 * automatic URL correction.
 *
 * Examples:
 * - "/tasks" -> "/w/{workspace-slug}/tasks"
 * - "/dashboard" -> "/w/{workspace-slug}"
 * - "/w/other-workspace/tasks" -> stays as-is (explicit workspace)
 * - "https://external.com" -> stays as-is (external URL)
 */
export function WorkspaceLink({ href, children, className, prefetch = true, ...linkProps }: WorkspaceLinkProps) {
  const { workspace } = useWorkspace();

  const getCorrectedHref = () => {
    // Don't modify external URLs
    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      return href;
    }

    // Don't modify URLs that already have workspace context
    if (href.startsWith("/w/") && href.includes("/")) {
      return href;
    }

    // Don't modify special pages that shouldn't be workspace-scoped
    const specialPages = ["/auth/", "/onboarding/", "/workspaces", "/api/", "/login", "/signup"];
    if (specialPages.some((page) => href.startsWith(page))) {
      return href;
    }

    // If no workspace is available, redirect to workspace selection
    if (!workspace?.slug) {
      return "/workspaces";
    }

    // Handle dashboard redirect
    if (href === "/dashboard" || href === "/") {
      return `/w/${workspace.slug}`;
    }

    // Handle relative paths and add workspace context
    if (href.startsWith("/")) {
      return `/w/${workspace.slug}${href}`;
    }

    // Handle relative paths without leading slash
    return `/w/${workspace.slug}/${href}`;
  };

  const correctedHref = getCorrectedHref();

  return (
    <Link href={correctedHref} className={className} prefetch={prefetch} {...linkProps}>
      {children}
    </Link>
  );
}

// Export a hook for programmatic URL correction
export function useWorkspaceUrl() {
  const { workspace } = useWorkspace();

  const getWorkspaceUrl = (path: string) => {
    // Don't modify external URLs
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }

    // Don't modify URLs that already have workspace context
    if (path.startsWith("/w/") && path.includes("/")) {
      return path;
    }

    // Special pages that shouldn't be workspace-scoped
    const specialPages = ["/auth/", "/onboarding/", "/workspaces", "/api/", "/login", "/signup"];
    if (specialPages.some((page) => path.startsWith(page))) {
      return path;
    }

    // If no workspace is available, redirect to workspace selection
    if (!workspace?.slug) {
      return "/workspaces";
    }

    // Handle dashboard redirect
    if (path === "/dashboard" || path === "/") {
      return `/w/${workspace.slug}`;
    }

    // Handle relative paths and add workspace context
    if (path.startsWith("/")) {
      return `/w/${workspace.slug}${path}`;
    }

    // Handle relative paths without leading slash
    return `/w/${workspace.slug}/${path}`;
  };

  return { getWorkspaceUrl, workspaceSlug: workspace?.slug };
}
