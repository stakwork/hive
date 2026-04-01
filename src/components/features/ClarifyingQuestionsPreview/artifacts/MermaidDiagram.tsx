"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { renderMermaidToSvg } from "@/lib/diagrams/mermaid-renderer";

interface MermaidDiagramProps {
  code: string;
  className?: string;
}

export function MermaidDiagram({ code, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const renderDiagram = useCallback(
    async (source: string, signal: { cancelled: boolean }) => {
      setSvg("");
      setError(null);

      try {
        const result = await renderMermaidToSvg(source);
        if (!signal.cancelled) setSvg(result);
      } catch (err) {
        if (!signal.cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to render diagram"
          );
        }
      }
    },
    []
  );

  useEffect(() => {
    const signal = { cancelled: false };
    renderDiagram(code, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [code, renderDiagram]);

  if (error) {
    return (
      <div
        className={cn(
          "rounded-md border border-destructive/50 bg-destructive/10 p-4",
          className
        )}
      >
        <p className="text-sm text-destructive mb-2">
          Failed to render diagram
        </p>
        <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
          {code}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-8 bg-muted/30 rounded-md",
          className
        )}
      >
        <div className="animate-pulse text-sm text-muted-foreground">
          Loading diagram...
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-auto rounded-md border border-border bg-muted/30 p-4",
        "max-h-[400px]",
        "[&_svg]:max-w-full [&_svg]:h-auto",
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
