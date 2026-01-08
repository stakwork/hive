"use client";

import type { QuestionArtifact } from "@/types/stakwork";
import { MermaidDiagram } from "./MermaidDiagram";
import { ComparisonTable } from "./ComparisonTable";

interface QuestionArtifactRendererProps {
  artifact: QuestionArtifact;
  className?: string;
}

export function QuestionArtifactRenderer({
  artifact,
  className,
}: QuestionArtifactRendererProps) {
  switch (artifact.type) {
    case "mermaid":
      return (
        <MermaidDiagram
          code={artifact.data as string}
          className={className}
        />
      );

    case "comparison_table":
      return (
        <ComparisonTable
          data={artifact.data as unknown as Parameters<typeof ComparisonTable>[0]["data"]}
          className={className}
        />
      );

    case "color_swatch":
      // Color swatches are handled directly in ClarifyingQuestionsPreview
      // as interactive options, not via this renderer
      return null;

    default:
      console.warn(`Unknown question artifact type: ${(artifact as { type: string }).type}`);
      return null;
  }
}
