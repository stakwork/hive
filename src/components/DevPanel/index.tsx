"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Database, ChevronUp, ChevronDown, Loader2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { ScenarioInfo } from "@/__tests__/support/scenarios/types";

/**
 * Format scenario name for display (snake_case -> Title Case)
 */
function formatScenarioName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Floating dev tools panel for test scenario management.
 * Only renders when USE_MOCKS=true (controlled by parent layout).
 *
 * Shows a small draggable floating button (default: top-left).
 * Expands to show available scenarios when clicked.
 */
export function DevPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);

  // Draggable state
  const [position, setPosition] = useState({ x: 16, y: 16 }); // top-left default
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchScenarios = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/mock/db/scenario");
      if (response.ok) {
        const data = await response.json();
        setScenarios(data.scenarios || []);
      }
    } catch (error) {
      console.error("[DevPanel] Failed to fetch scenarios:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch scenarios when expanded
  useEffect(() => {
    if (isExpanded && scenarios.length === 0) {
      fetchScenarios();
    }
  }, [isExpanded, scenarios.length, fetchScenarios]);

  const runScenario = async (name: string) => {
    setRunningScenario(name);
    try {
      const response = await fetch("/api/mock/db/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        toast.success(`${formatScenarioName(name)} loaded`, {
          description: "Database seeded with test data",
        });
        setIsExpanded(false); // Auto-collapse after success
      } else {
        const error = await response.json();
        toast.error("Scenario failed", {
          description: error.error || "Failed to run scenario",
        });
      }
    } catch (error) {
      console.error("[DevPanel] Failed to run scenario:", error);
      toast.error("Scenario failed", {
        description: "Failed to connect to scenario API",
      });
    } finally {
      setRunningScenario(null);
    }
  };

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (containerRef.current) {
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    }
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        const newX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x));
        const newY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.current.y));
        setPosition({ x: newX, y: newY });
      }
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add/remove global mouse listeners for dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className="fixed z-50"
      style={{ left: position.x, top: position.y }}
    >
      {/* Toggle button with drag handle */}
      <div className="flex items-center gap-0.5">
        <div
          onMouseDown={handleMouseDown}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded-l-md border border-r-0 bg-background"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsExpanded(!isExpanded)}
          className="shadow-lg bg-background hover:bg-muted rounded-l-none"
        >
          <Database className="h-4 w-4 mr-1.5" />
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 font-semibold"
          >
            DEV
          </Badge>
          {isExpanded ? (
            <ChevronUp className="h-3 w-3 ml-1.5" />
          ) : (
            <ChevronDown className="h-3 w-3 ml-1.5" />
          )}
        </Button>
      </div>

      {/* Expanded panel - drops below toggle */}
      {isExpanded && (
        <div className="mt-2 bg-background border rounded-lg shadow-lg p-3 w-72 max-h-96 overflow-y-auto">
          <div className="text-sm font-medium flex items-center gap-2 text-foreground">
            <Database className="h-4 w-4" />
            Scenarios
          </div>
          <div className="text-[10px] text-muted-foreground mb-3">
            Scenarios seed the database with test data.
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : scenarios.length === 0 ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              No scenarios available
            </div>
          ) : (
            <div className="space-y-1">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.name}
                  onClick={() => runScenario(scenario.name)}
                  disabled={runningScenario !== null}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {formatScenarioName(scenario.name)}
                    </span>
                    {runningScenario === scenario.name && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {scenario.description}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DevPanel;
