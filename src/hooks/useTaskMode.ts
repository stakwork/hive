"use client";

import { useState, useEffect } from "react";
import { isDevelopmentMode } from "@/lib/runtime";

export function useTaskMode() {
  const [taskMode, setTaskModeState] = useState<string>("live");

  // Load from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem("task_mode");
    if (savedMode) {
      // Handle legacy modes that are no longer available
      if (savedMode === "unit" || savedMode === "integration") {
        setTaskModeState("live");
        localStorage.setItem("task_mode", "live");
      } else if (savedMode === "test" && !isDevelopmentMode()) {
        // If test mode is saved but not in development, default to live
        setTaskModeState("live");
        localStorage.setItem("task_mode", "live");
      } else {
        setTaskModeState(savedMode);
      }
    }
  }, []);

  // Set mode and persist to localStorage
  const setTaskMode = (mode: string) => {
    // Validate that test mode is only available in development
    if (mode === "test" && !isDevelopmentMode()) {
      return;
    }
    setTaskModeState(mode);
    localStorage.setItem("task_mode", mode);
  };

  return { taskMode, setTaskMode };
}