"use client";

import type { QuestionArtifact } from "@/types/stakwork";
import { MermaidDiagram } from "./MermaidDiagram";

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
          code={artifact.data.code as string}
          className={className}
        />
      );

    default:
      console.warn(`Unknown question artifact type: ${(artifact as { type: string }).type}`);
      return null;
  }
}
