"use client";

import { useState, useEffect } from "react";

export function useTaskMode() {
  const [taskMode, setTaskModeState] = useState<string>("live");

  // Load from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem("task_mode");
    if (savedMode) {
      setTaskModeState(savedMode);
    }
  }, []);

  // Set mode and persist to localStorage
  const setTaskMode = (mode: string) => {
    setTaskModeState(mode);
    localStorage.setItem("task_mode", mode);
  };

  return { taskMode, setTaskMode };
}