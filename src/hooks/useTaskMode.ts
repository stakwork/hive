"use client";

import { useState, useEffect } from "react";
import { isDevelopmentMode } from "@/lib/runtime";

export function useTaskMode() {
  const [taskMode, setTaskModeState] = useState<string>("live");

  // Load from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem("task_mode");
    if (savedMode && (savedMode === "live" || (savedMode === "test" && isDevelopmentMode()))) {
      setTaskModeState(savedMode);
    } else {
      // Default to live mode for any invalid or unavailable modes
      setTaskModeState("live");
      localStorage.setItem("task_mode", "live");
    }
  }, []);

  // Set mode and persist to localStorage
  const setTaskMode = (mode: string) => {
    // Only allow valid modes: live, or test in development
    if (mode === "live" || (mode === "test" && isDevelopmentMode())) {
      setTaskModeState(mode);
      localStorage.setItem("task_mode", mode);
    }
  };

  return { taskMode, setTaskMode };
}