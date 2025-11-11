import { Button } from "@/components/ui/button";
import { X, CheckCircle2, Loader2, Camera, Play, Square } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import { Screenshot } from "@/types/common";
import { ScreenshotModal } from "@/components/ScreenshotModal";
import { getRelativeUrl } from "@/lib/utils";

interface Action {
  id: string;
  type: string;
  timestamp: number;
  locator?: {
    primary: string;
    text?: string;
  };
  value?: string;
  url?: string;
  expectedUrl?: string;
  formType?: string;
  checked?: boolean;
}

interface ActionsListProps {
  actions: Action[];
  onRemoveAction: (action: Action) => void;
  onClearAll: () => void;
  isRecording: boolean;
  isReplaying?: boolean;
  currentActionIndex?: number;
  totalActions?: number;
  screenshots?: Screenshot[];
  title?: string;
  onReplayToggle?: () => void;
}

// Helper function to extract the most descriptive element identifier
function getElementDescription(action: Action): string {
  const selector = action.locator?.primary;
  if (!selector) return "element";

  // Extract ID (highest priority)
  if (selector.includes("#")) {
    const idMatch = selector.match(/#([^.\s[]+)/);
    if (idMatch) return `#${idMatch[1]}`;
  }

  // Extract class (medium priority, limit to first class)
  if (selector.includes(".") && !selector.startsWith("text=")) {
    const classMatch = selector.match(/\.([^.\s[#]+)/);
    if (classMatch) return `.${classMatch[1]}`;
  }

  // Extract attribute selectors like [name="email"]
  if (selector.includes("[")) {
    const attrMatch = selector.match(/\[([^=\]]+)=?"?([^"\]]*)"?\]/);
    if (attrMatch) {
      const attrName = attrMatch[1];
      const attrValue = attrMatch[2];
      if (attrValue) {
        return `[${attrName}="${attrValue}"]`;
      }
      return `[${attrName}]`;
    }
  }

  return selector;
}

function getActionDisplay(action: Action): React.ReactNode {
  const actionType = action.type;

  switch (actionType) {
    case "nav":
    case "goto":
      const navUrl = action.url || action.value || "/";
      return (
        <>
          Navigate to <span className="text-primary">{getRelativeUrl(navUrl)}</span>
        </>
      );
    case "click":
      if (action.locator?.text) {
        const elementDesc = getElementDescription(action);
        return (
          <>
            Click <span className="text-primary">&quot;{action.locator.text}&quot;</span>
            {elementDesc !== "element" && <span className="text-muted-foreground"> ({elementDesc})</span>}
          </>
        );
      }
      const clickDesc = getElementDescription(action);
      return (
        <>
          Click <span className="text-primary">{clickDesc}</span>
        </>
      );
    case "input":
      const inputValue =
        action.value && action.value.length > 30 ? action.value.substring(0, 30) + "..." : action.value;
      const inputDesc = getElementDescription(action);
      return (
        <>
          Type <span className="text-primary">&quot;{inputValue}&quot;</span>
          {inputDesc !== "element" && <span className="text-muted-foreground"> in {inputDesc}</span>}
        </>
      );
    case "form":
      const formDesc = getElementDescription(action);
      if (action.formType === "checkbox" || action.formType === "radio") {
        return (
          <>
            {action.checked ? "Check" : "Uncheck"}{" "}
            <span className="text-primary">{formDesc !== "element" ? formDesc : action.formType}</span>
          </>
        );
      } else if (action.formType === "select") {
        return (
          <>
            Select <span className="text-primary">&quot;{action.value}&quot;</span>
            {formDesc !== "element" && <span className="text-muted-foreground"> from {formDesc}</span>}
          </>
        );
      }
      return (
        <>
          Form: <span className="text-primary">{action.value}</span>
          {formDesc !== "element" && <span className="text-muted-foreground"> in {formDesc}</span>}
        </>
      );
    case "assertion":
      const assertText =
        action.value && action.value.length > 30 ? action.value.substring(0, 30) + "..." : action.value;
      const assertDesc = getElementDescription(action);
      return (
        <>
          Assert <span className="text-primary">&quot;{assertText}&quot;</span>
          {assertDesc !== "element" && <span className="text-muted-foreground"> in {assertDesc}</span>}
        </>
      );
    case "waitForURL":
      const waitUrl = action.expectedUrl || action.value || "navigation";
      return (
        <>
          Wait for <span className="text-primary">{waitUrl === "navigation" ? waitUrl : getRelativeUrl(waitUrl)}</span>
        </>
      );
    default:
      return <span className="text-primary">{actionType}</span>;
  }
}

// Get border color class for action type
function getActionBorderColor(kind: string): string {
  switch (kind) {
    case "nav":
    case "goto":
      return "border-l-blue-500";
    case "click":
      return "border-l-green-500";
    case "input":
      return "border-l-amber-500";
    case "form":
      return "border-l-purple-500";
    case "assertion":
      return "border-l-red-500";
    case "waitForURL":
      return "border-l-muted-foreground";
    default:
      return "border-l-border";
  }
}

export function ActionsList({
  actions,
  onRemoveAction,
  onClearAll,
  isRecording,
  isReplaying = false,
  currentActionIndex = -1,
  totalActions = 0,
  screenshots = [],
  title,
  onReplayToggle,
}: ActionsListProps) {
  const actionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  // Auto-scroll to current action during replay
  useEffect(() => {
    if (isReplaying && currentActionIndex >= 0 && actionRefs.current[currentActionIndex]) {
      const actionElement = actionRefs.current[currentActionIndex];
      const container = scrollContainerRef.current;

      if (actionElement && container) {
        // Scroll with smooth behavior and center alignment
        actionElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [isReplaying, currentActionIndex]);

  // Get action status based on replay progress
  const getActionStatus = (index: number): "pending" | "active" | "completed" => {
    if (!isReplaying) return "pending";
    if (index < currentActionIndex) return "completed";
    if (index === currentActionIndex) return "active";
    return "pending";
  };

  // Get status icon for action
  const getStatusIcon = (status: "pending" | "active" | "completed") => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />;
      case "active":
        return <Loader2 className="h-3 w-3 text-blue-500 animate-spin flex-shrink-0" />;
      default:
        return null;
    }
  };

  // Find screenshot for a given action index
  const getScreenshotForAction = (index: number): Screenshot | undefined => {
    return screenshots.find((s) => s.actionIndex === index);
  };

  return (
    <div className="h-full flex flex-col border bg-card shadow-lg backdrop-blur-sm" data-testid="actions-list">
      <div className="flex flex-col gap-2 p-3 border-b flex-shrink-0">
        {title && (
          <div className="text-xs font-medium text-muted-foreground truncate" title={title}>
            {title}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {isReplaying ? (
              <>
                Replaying ({currentActionIndex + 1}/{totalActions})
              </>
            ) : (
              <>Test Actions ({actions.length})</>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {onReplayToggle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onReplayToggle}
                className="h-8 w-8 p-0"
                title={isReplaying ? "Stop replay" : "Start replay"}
              >
                {isReplaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            )}
            {isRecording && !isReplaying && actions.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onClearAll}
              >
                Clear All
              </Button>
            )}
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
        {actions.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {onReplayToggle && !isRecording ? "Ready to replay" : "No actions recorded yet"}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {actions.map((action, index) => {
              const status = getActionStatus(index);
              const isActive = status === "active";
              const isCompleted = status === "completed";
              const screenshot = getScreenshotForAction(index);
              const actionType = action.type;
              // Only waitForURL actions get screenshots (goto is skipped)
              const isNavAction = actionType === "waitForURL";
              const hasScreenshot = isNavAction && !!screenshot;

              return (
                <div
                  key={action.id || `action-${index}`}
                  ref={(el) => {
                    actionRefs.current[index] = el;
                  }}
                  className={`flex items-center gap-2 rounded border-l-4 ${getActionBorderColor(
                    actionType,
                  )} p-1.5 transition-all duration-200 ${
                    isActive
                      ? "bg-blue-100 dark:bg-blue-900/30 shadow-md ring-2 ring-blue-400 dark:ring-blue-600"
                      : isCompleted
                        ? "bg-green-50 dark:bg-green-900/20 opacity-70"
                        : "bg-muted/50 hover:bg-muted"
                  }`}
                  title={`${actionType}: ${action.url || action.locator?.text || action.locator?.primary || action.value || ""}`}
                  data-testid={`action-item-${index}`}
                >
                  {isReplaying && getStatusIcon(status)}
                  {hasScreenshot && (
                    <button
                      onClick={() => setSelectedScreenshot(screenshot)}
                      className="flex-shrink-0 w-8 h-8 rounded overflow-hidden border border-border hover:border-primary transition-colors"
                      title="Click to view screenshot"
                      aria-label={`View screenshot of ${screenshot.url} at action ${index + 1}`}
                      data-testid={`screenshot-thumbnail-${index}`}
                    >
                      <img
                        src={screenshot.dataUrl}
                        alt={`Screenshot of ${screenshot.url} at action ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  )}
                  {isNavAction && !hasScreenshot && (
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded flex items-center justify-center bg-muted border border-border"
                      title="No screenshot available"
                      role="img"
                      aria-label="No screenshot available for this action"
                      data-testid={`screenshot-placeholder-${index}`}
                    >
                      <Camera className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 text-xs overflow-hidden text-ellipsis whitespace-nowrap">
                    {getActionDisplay(action)}
                  </div>
                  {isRecording && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveAction(action)}
                      disabled={isReplaying}
                      className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
                      title="Remove this action"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ScreenshotModal
        screenshot={selectedScreenshot}
        allScreenshots={screenshots}
        isOpen={!!selectedScreenshot}
        onClose={() => setSelectedScreenshot(null)}
        onNavigate={setSelectedScreenshot}
      />
    </div>
  );
}
