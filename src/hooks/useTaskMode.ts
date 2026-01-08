"use client";

import { useState, useEffect } from "react";
import { isDevelopmentMode } from "@/lib/runtime";

export type TaskMode = "live" | "test" | "agent" | "workflow_editor" | "prompts";

export function useTaskMode() {
  const [taskMode, setTaskModeState] = useState<TaskMode>("live");

  // Load from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem("task_mode");
    if (savedMode && isValidMode(savedMode)) {
      setTaskModeState(savedMode as TaskMode);
    } else {
      // Default to live mode for any invalid or unavailable modes
      setTaskModeState("live");
      localStorage.setItem("task_mode", "live");
    }
  }, []);

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
  if (mode === "live" || mode === "agent" || mode === "workflow_editor" || mode === "prompts") return true;
  if (mode === "test" && isDevelopmentMode()) return true;
  return false;
}