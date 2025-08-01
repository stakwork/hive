"use client";

import { useEffect } from "react";
import { initializeDebugMessageListener } from "@/lib/dom-inspector";

/**
 * Client component that initializes the debug message listener
 * This makes Hive respond to debug postMessage requests when loaded in an iframe
 */
export default function DebugMessageListener() {
  useEffect(() => {
    // Initialize the debug message listener when component mounts
    initializeDebugMessageListener();
  }, []);

  // This component doesn't render anything - it just sets up the message listener
  return null;
}