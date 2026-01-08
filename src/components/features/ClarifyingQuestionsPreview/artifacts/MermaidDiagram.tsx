"use client";

import { useEffect, useRef, useState, useId } from "react";
import { cn } from "@/lib/utils";

interface MermaidDiagramProps {
  code: string;
  className?: string;
}

export function MermaidDiagram({ code, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId().replace(/:/g, "-");

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (!code.trim()) {
        setError("No diagram code provided");
        return;
      }

      try {
        // Dynamic import to avoid SSR issues
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          fontFamily: "inherit",
          themeVariables: {
            // Node colors
            primaryColor: "#3b82f6",
            primaryTextColor: "#ffffff",
            primaryBorderColor: "#60a5fa",
            // Lines and arrows
            lineColor: "#94a3b8",
            // Secondary elements
            secondaryColor: "#1e293b",
            secondaryTextColor: "#e2e8f0",
            secondaryBorderColor: "#475569",
            // Background
            background: "transparent",
            mainBkg: "#1e293b",
            // Text
            textColor: "#e2e8f0",
            // Sequence diagram specific
            actorTextColor: "#e2e8f0",
            actorBkg: "#1e293b",
            actorBorder: "#475569",
            signalColor: "#94a3b8",
            signalTextColor: "#e2e8f0",
            labelBoxBkgColor: "#1e293b",
            labelBoxBorderColor: "#475569",
            labelTextColor: "#e2e8f0",
            loopTextColor: "#e2e8f0",
            noteBkgColor: "#334155",
            noteTextColor: "#e2e8f0",
            noteBorderColor: "#475569",
            // Flowchart specific
            nodeBkg: "#1e293b",
            nodeBorder: "#475569",
            clusterBkg: "#0f172a",
            clusterBorder: "#334155",
            defaultLinkColor: "#94a3b8",
            edgeLabelBackground: "#1e293b",
          },
          flowchart: {
            curve: "basis",
            padding: 15,
          },
          sequence: {
            actorMargin: 50,
            boxMargin: 10,
            boxTextMargin: 5,
            noteMargin: 10,
            messageMargin: 35,
          },
        });

        const { svg: renderedSvg } = await mermaid.render(
          `mermaid-${uniqueId}`,
          code.trim()
        );

        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Mermaid render error:", err);
          setError(err instanceof Error ? err.message : "Failed to render diagram");
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, uniqueId]);

  if (error) {
    return (
      <div className={cn("rounded-md border border-destructive/50 bg-destructive/10 p-4", className)}>
        <p className="text-sm text-destructive mb-2">Failed to render diagram</p>
        <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
          {code}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={cn("flex items-center justify-center p-8 bg-muted/30 rounded-md", className)}>
        <div className="animate-pulse text-sm text-muted-foreground">Loading diagram...</div>
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
