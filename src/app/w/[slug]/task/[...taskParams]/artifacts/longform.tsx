import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { LongformContent, Artifact } from "@/lib/chat";
import { useRef, useState, useEffect } from "react";
import { WorkflowUrlLink } from "../components/WorkflowUrlLink";
import { getArtifactIcon } from "@/lib/icons";

export function LongformArtifactPanel({
  artifacts,
  workflowUrl,
}: {
  artifacts: Artifact[];
  workflowUrl?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handle = () => {
      setShowFade(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    el.addEventListener("scroll", handle);
    handle();
    return () => el.removeEventListener("scroll", handle);
  }, [artifacts]);

  if (artifacts.length === 0) return null;

  return (
    <div 
      className="h-full flex flex-col relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
      
      {/* Workflow URL Link */}
      {workflowUrl && (
        <WorkflowUrlLink 
          workflowUrl={workflowUrl}
          className={isHovered ? "opacity-100" : "opacity-0"}
        />
      )}
    </div>
  );
}
