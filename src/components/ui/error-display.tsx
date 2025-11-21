import React from "react";
import { AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { WORKSPACE_ERRORS } from "@/lib/constants";

export interface ErrorDisplayConfig {
  type: "error" | "warning" | "info";
  title?: string;
  description?: string;
  helpText?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// Centralized error configuration mapping
const ERROR_CONFIGS: Record<string, ErrorDisplayConfig> = {
  [WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED]: {
    type: "error",
    title: "Workspace Limit Reached",
    description: "You can only create up to 2 workspaces.",
    helpText: "You can delete an existing workspace to create a new one.",
  },
  [WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS]: {
    type: "error",
    title: "Name Already Taken",
    description: "A workspace with this name already exists.",
    helpText: "Please choose a different name for your workspace.",
  },
  [WORKSPACE_ERRORS.SLUG_INVALID_FORMAT]: {
    type: "error",
    title: "Invalid Name Format",
    description: "Workspace name must start and end with letters or numbers.",
    helpText: "You can only use letters, numbers, and hyphens.",
  },
  [WORKSPACE_ERRORS.SLUG_INVALID_LENGTH]: {
    type: "error",
    title: "Invalid Name Length",
    description: "Workspace name must be between 2 and 50 characters.",
  },
  [WORKSPACE_ERRORS.SLUG_RESERVED]: {
    type: "error",
    title: "Reserved Name",
    description: "This workspace name is reserved by the system.",
    helpText: "Please choose a different name for your workspace.",
  },
  [WORKSPACE_ERRORS.NOT_FOUND]: {
    type: "error",
    title: "Workspace Not Found",
    description: "The requested workspace could not be found.",
  },
  [WORKSPACE_ERRORS.ACCESS_DENIED]: {
    type: "error",
    title: "Access Denied",
    description: "You do not have permission to access this workspace.",
  },
};

interface ErrorDisplayProps {
  error: string | null;
  className?: string;
  compact?: boolean;
  onActionClick?: () => void;
}

export function ErrorDisplay({ error, className = "", compact = false, onActionClick }: ErrorDisplayProps) {
  if (!error) return null;

  // Get configuration for this error, or create a default one
  const config = ERROR_CONFIGS[error] || {
    type: "error" as const,
    title: "Error",
    description: error,
  };

  const getAlertVariant = (type: ErrorDisplayConfig["type"]) => {
    switch (type) {
      case "warning":
        return "default";
      case "info":
        return "default";
      case "error":
      default:
        return "destructive";
    }
  };

  const getIcon = (type: ErrorDisplayConfig["type"]) => {
    switch (type) {
      case "info":
        return <Info className="h-4 w-4" />;
      case "warning":
      case "error":
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  if (compact) {
    return (
      <div className={`text-sm text-destructive ${className}`}>
        <p>{config.description}</p>
        {config.helpText && <p className="text-xs text-muted-foreground mt-1">{config.helpText}</p>}
      </div>
    );
  }

  return (
    <Alert variant={getAlertVariant(config.type)} className={className}>
      {getIcon(config.type)}
      <AlertDescription>
        <div className="space-y-2">
          {config.title && <p className="font-medium">{config.title}</p>}
          <p>{config.description}</p>
          {config.helpText && <p className="text-xs opacity-90">{config.helpText}</p>}
          {config.action && (
            <button onClick={onActionClick || config.action.onClick} className="text-xs underline hover:no-underline">
              {config.action.label}
            </button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

// Utility function to classify unknown errors
export function classifyError(error: string): ErrorDisplayConfig {
  return (
    ERROR_CONFIGS[error] || {
      type: "error",
      title: "Something went wrong",
      description: error,
    }
  );
}

// Hook for error handling
export function useErrorDisplay() {
  return {
    getErrorConfig: classifyError,
    isWorkspaceError: (error: string) => Object.keys(ERROR_CONFIGS).includes(error),
  };
}
