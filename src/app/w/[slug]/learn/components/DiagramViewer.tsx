"use client";

import { useEffect, useRef, useState, useId } from "react";
import { cn } from "@/lib/utils";

interface DiagramViewerProps {
  name: string;
  body: string;
  description?: string | null;
}

export function DiagramViewer({ name, body, description }: DiagramViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId().replace(/:/g, "-");

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (!body.trim()) {
        setError("No diagram code provided");
        return;
      }

      setSvg("");
      setError(null);

      try {
        const mermaid = (await import("mermaid")).default;

        // Register ELK layout loader
        try {
          const elkLoader = await import("@mermaid-js/layout-elk");
          mermaid.registerLayoutLoaders(elkLoader.default ?? elkLoader);
        } catch {
          // ELK layout registration is optional; continue without it
        }

        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          layout: "elk",
          securityLevel: "loose",
          fontFamily: "inherit",
          themeVariables: {
            primaryColor: "#3b82f6",
            primaryTextColor: "#ffffff",
            primaryBorderColor: "#60a5fa",
            lineColor: "#94a3b8",
            secondaryColor: "#1e293b",
            secondaryTextColor: "#e2e8f0",
            secondaryBorderColor: "#475569",
            background: "transparent",
            mainBkg: "#1e293b",
            textColor: "#e2e8f0",
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
            nodeBkg: "#1e293b",
            nodeBorder: "#475569",
            clusterBkg: "#0f172a",
            clusterBorder: "#334155",
            defaultLinkColor: "#94a3b8",
            edgeLabelBackground: "#1e293b",
          },
          flowchart: { curve: "basis", padding: 15 },
          sequence: {
            actorMargin: 50,
            boxMargin: 10,
            boxTextMargin: 5,
            noteMargin: 10,
            messageMargin: 35,
          },
        });

        const { svg: renderedSvg } = await mermaid.render(
          `diagram-${uniqueId}`,
          body.trim()
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
  }, [body, uniqueId]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
          {!description && (
            <p className="text-sm text-muted-foreground">Diagram</p>
          )}
        </div>
      </div>

      {/* Diagram area */}
      <div className="flex-1 overflow-y-auto p-6">
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive mb-2">Failed to render diagram</p>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
              {body}
            </pre>
          </div>
        ) : !svg ? (
          <div className="flex items-center justify-center p-8 bg-muted/30 rounded-md">
            <div className="animate-pulse text-sm text-muted-foreground">Loading diagram...</div>
          </div>
        ) : (
          <div
            ref={containerRef}
            className={cn(
              "overflow-auto rounded-md border border-border bg-muted/30 p-4",
              "[&_svg]:max-w-full [&_svg]:h-auto"
            )}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
}
