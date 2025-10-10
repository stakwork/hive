import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface Action {
  id: string;
  kind: string;
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
  switch (action.kind) {
    case "nav":
      return (
        <>
          Navigate to <span className="text-primary">{action.url || "/"}</span>
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
    case "waitForUrl":
      return (
        <>
          Wait for <span className="text-primary">{action.expectedUrl || "navigation"}</span>
        </>
      );
    default:
      return <span className="text-primary">{action.kind}</span>;
  }
}

// Get border color class for action type
function getActionBorderColor(kind: string): string {
  switch (kind) {
    case "nav":
      return "border-l-blue-500";
    case "click":
      return "border-l-green-500";
    case "input":
      return "border-l-amber-500";
    case "form":
      return "border-l-purple-500";
    case "assertion":
      return "border-l-red-500";
    case "waitForUrl":
      return "border-l-muted-foreground";
    default:
      return "border-l-border";
  }
}

export function ActionsList({ actions, onRemoveAction, onClearAll, isRecording }: ActionsListProps) {
  return (
    <div className="rounded-lg border bg-card shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold">Test Actions ({actions.length})</h3>
        <Button variant="destructive" size="sm" onClick={onClearAll} disabled={!isRecording || actions.length === 0}>
          Clear All
        </Button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {actions.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No actions recorded yet</div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {actions.map((action) => (
              <div
                key={action.id}
                className={`flex items-center justify-between rounded border-l-4 ${getActionBorderColor(
                  action.kind,
                )} bg-muted/50 p-2 transition-colors hover:bg-muted`}
              >
                <div className="flex-1 text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                  {getActionDisplay(action)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveAction(action)}
                  disabled={!isRecording}
                  className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                  title="Remove this action"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
