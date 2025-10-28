import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { LongformContent, Artifact } from "@/lib/chat";
import { useRef, useState, useEffect } from "react";
import { WorkflowUrlLink } from "../components/WorkflowUrlLink";
import { getArtifactIcon } from "@/lib/icons";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const [isCollapsed, setIsCollapsed] = useState(true);

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
      <Collapsible open={!isCollapsed} onOpenChange={(open) => setIsCollapsed(!open)}>
        <div className="bg-background/50 border rounded-lg p-4 relative">
          {/* Header with title and toggle button */}
          {artifacts[0] && (() => {
            const content = artifacts[0].content as LongformContent;
            return content.title ? (
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-semibold text-lg flex items-center gap-2 flex-1">
                  {getArtifactIcon(artifacts[0].icon || 'agent')}
                  <span className="line-clamp-2">{content.title}</span>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 flex-shrink-0"
                  >
                    {isCollapsed ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              </div>
            ) : null;
          })()}

          <CollapsibleContent>
            <div
              ref={scrollRef}
              className="max-h-80 overflow-auto whitespace-normal relative"
            >
              {artifacts.map((artifact) => {
                const content = artifact.content as LongformContent;
                return (
                  <div key={artifact.id}>
                    <MarkdownRenderer size="compact">{content.text}</MarkdownRenderer>
                  </div>
                );
              })}
            </div>
            {showFade && (
              <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-background" />
            )}
          </CollapsibleContent>

          {/* Collapsed preview - show first few lines */}
          {isCollapsed && artifacts[0] && (() => {
            const content = artifacts[0].content as LongformContent;
            const previewText = content.text.slice(0, 150) + (content.text.length > 150 ? "..." : "");
            return (
              <div className="text-sm text-muted-foreground line-clamp-2">
                {previewText}
              </div>
            );
          })()}
        </div>
      </Collapsible>

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
