"use client";

import { useState } from "react";
import { isDevelopmentMode } from "@/lib/runtime";

export type TaskMode = "live" | "test" | "agent" | "workflow_editor" | "project_debugger" | "prompts";

export function useTaskMode() {
  // Use lazy initializer to synchronously read from localStorage
  // This ensures taskMode is correctly initialized before any effects that depend on it
  const [taskMode, setTaskModeState] = useState<TaskMode>(() => {
    if (typeof window === "undefined") return "live";
    
    const savedMode = localStorage.getItem("task_mode");
    if (savedMode && isValidMode(savedMode)) {
      return savedMode as TaskMode;
    }
    
    // Default to live mode for any invalid or unavailable modes
    localStorage.setItem("task_mode", "live");
    return "live";
  });

  // Set mode and persist to localStorage
  const setTaskMode = (mode: string) => {
    // Only allow valid modes: live, agent (always), or test (dev only)
    if (isValidMode(mode)) {
      setTaskModeState(mode as TaskMode);
      localStorage.setItem("task_mode", mode);
    }
  };

  return { taskMode, setTaskMode };
}

function isValidMode(mode: string): boolean {
  if (mode === "live" || mode === "agent" || mode === "workflow_editor" || mode === "project_debugger" || mode === "prompts") return true;
  if (mode === "test" && isDevelopmentMode()) return true;
  return false;
}
