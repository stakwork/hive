import React, { memo, useRef, useState, useEffect, useMemo } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { LongformContent, Artifact } from "@/lib/chat";
import { WorkflowUrlLink } from "../components/WorkflowUrlLink";
import { getArtifactIcon } from "@/lib/icons";

interface LongformArtifactPanelProps {
  artifacts: Artifact[];
  workflowUrl?: string;
}

export const LongformArtifactPanel = memo(function LongformArtifactPanel({
  artifacts,
  workflowUrl,
}: LongformArtifactPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(true);

  // Memoize artifact IDs for stable dependency
  const artifactIds = useMemo(() => artifacts.map(a => a.id).join(','), [artifacts]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handle = () => {
      setShowFade(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    el.addEventListener("scroll", handle);
    handle();
    return () => el.removeEventListener("scroll", handle);
  }, [artifactIds]);

  if (artifacts.length === 0) return null;

  return (
    <div className="h-full flex flex-col relative group">
      <div
        ref={scrollRef}
        className="bg-background/50 border rounded-lg p-4 max-h-80 overflow-auto whitespace-normal relative"
      >
        {artifacts.map((artifact) => {
          const content = artifact.content as LongformContent;
          return (
            <div key={artifact.id}>
              {content.title && (
                <div className="font-semibold text-lg mb-2 flex items-center gap-2">
                  {getArtifactIcon(artifact.icon || 'agent')}
                  <span className="line-clamp-2">{content.title}</span>
                </div>
              )}
              <MarkdownRenderer>{content.text}</MarkdownRenderer>
            </div>
          );
        })}
      </div>
      {showFade && (
        <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-background" />
      )}

      {/* Workflow URL Link - uses CSS group-hover for stable hover state */}
      {workflowUrl && (
        <WorkflowUrlLink
          workflowUrl={workflowUrl}
          className="opacity-0 group-hover:opacity-100"
        />
      )}
    </div>
  );
});
