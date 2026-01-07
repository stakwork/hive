"use client";

import type { OptionArtifact } from "@/types/stakwork";
import { ColorSwatch } from "./ColorSwatch";

interface ArtifactRendererProps {
  artifact: OptionArtifact;
  label?: string;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  onClick?: () => void;
}

export function ArtifactRenderer({
  artifact,
  label,
  size,
  selected,
  onClick,
}: ArtifactRendererProps) {
  switch (artifact.type) {
    case "color_swatch":
      return (
        <ColorSwatch
          color={artifact.data.color as string}
          label={label}
          size={size}
          selected={selected}
          onClick={onClick}
        />
      );

    default:
      console.warn(`Unknown artifact type: ${(artifact as { type: string }).type}`);
      return null;
  }
}
