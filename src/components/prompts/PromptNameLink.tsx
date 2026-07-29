"use client";

import React, { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";

// ─── PromptNameLink ───────────────────────────────────────────────────────────

interface PromptNameLinkProps {
  name: string;
  promptId: string;
}

/**
 * Renders a prompt name as a synchronous inline button — `promptId` is already
 * known from pre-verification, so clicking opens the URL immediately with no
 * additional network request.
 */
export function PromptNameLink({ name, promptId }: PromptNameLinkProps) {
  const { slug } = useWorkspace();

  return (
    <button
      type="button"
      onClick={() =>
        window.open(
          `/w/${slug}/prompts?prompt=${promptId}`,
          "_blank",
          "noopener,noreferrer",
        )
      }
      className="inline-flex items-center gap-0.5 font-mono text-xs bg-muted/60 hover:bg-muted border border-border/30 rounded px-0.5 cursor-pointer transition-colors"
    >
      <code>{name}</code>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </button>
  );
}

// ─── VersionRefLink ───────────────────────────────────────────────────────────

interface VersionRefLinkProps {
  label: string;
  versionNumber: number;
  promptId: string;
}

/**
 * Renders a version reference as a lazy-resolving inline button. `promptId` is
 * already known, so only the versions list needs to be fetched on the first click.
 * The resolved URL is cached in a ref to avoid repeat fetches.
 */
export function VersionRefLink({
  label,
  versionNumber,
  promptId,
}: VersionRefLinkProps) {
  const { slug } = useWorkspace();
  const [isLoading, setIsLoading] = useState(false);
  const resolvedVersionUrlRef = useRef<string | null>(null);

  const handleClick = async () => {
    if (isLoading) return;

    // Use cached URL if already resolved.
    if (resolvedVersionUrlRef.current) {
      window.open(resolvedVersionUrlRef.current, "_blank", "noopener,noreferrer");
      return;
    }

    const fallbackUrl = `/w/${slug}/prompts?prompt=${promptId}`;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/workflow/prompts/${promptId}/versions`);

      if (!res.ok) {
        // 403 (workspace access restriction) or any other error → fall back silently.
        resolvedVersionUrlRef.current = fallbackUrl;
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        return;
      }

      const data = await res.json();
      const versions: Array<{ id: string; version_number: number }> =
        data?.data?.versions ?? [];

      const match = versions.find((v) => v.version_number === versionNumber);
      const url = match
        ? `/w/${slug}/prompts?prompt=${promptId}&version=${match.id}`
        : fallbackUrl;

      resolvedVersionUrlRef.current = url;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Network error → fall back silently.
      resolvedVersionUrlRef.current = fallbackUrl;
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      disabled={isLoading}
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 text-sm cursor-pointer hover:text-foreground text-muted-foreground transition-colors"
    >
      {label}
      <ExternalLink className="h-3 w-3 inline-block ml-0.5 shrink-0" />
    </button>
  );
}
