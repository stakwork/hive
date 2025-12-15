"use client";

/**
 * DevPanel Component
 * 
 * Floating developer panel for one-click scenario execution in mock mode.
 * Only renders when USE_MOCKS=true for production safety.
 */

import React, { useState, useEffect, useCallback } from "react";
import { config } from "@/config/env";
import { toast } from "sonner";

interface Scenario {
  id: string;
  name: string;
  description: string;
  metadata: {
    tags: string[];
    schemaVersion: string;
  };
}

export default function DevPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Production safety - return null if not in mock mode
  if (!config.USE_MOCKS) {
    return null;
  }

  // Fetch scenarios on mount
  useEffect(() => {
    const fetchScenarios = async () => {
      try {
        const response = await fetch("/api/mock/db/scenario");
        if (!response.ok) {
          throw new Error(`Failed to fetch scenarios: ${response.statusText}`);
        }

        const data = await response.json();
        setScenarios(data.scenarios || []);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to load scenarios";
        setError(errorMessage);
        console.error("DevPanel: Error fetching scenarios:", err);
      }
    };

    fetchScenarios();
  }, []);

  // Execute scenario handler
  const executeScenario = useCallback(async (scenarioName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/mock/db/scenario", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenarioName }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Execution failed: ${response.statusText}`);
      }

      const data = await response.json();

      // Show success toast
      toast.success("Scenario executed successfully!", {
        description: data.result.message,
      });

      // Wait briefly then reload page to show seeded data
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Scenario execution failed";
      setError(errorMessage);
      toast.error("Execution failed", {
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="fixed top-4 left-4 z-[9999]">
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-all hover:scale-110"
          title="Open DevPanel"
          data-testid="devpanel-toggle"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
            />
          </svg>
        </button>
      )}

      {/* Expanded Panel */}
      {isOpen && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-4 w-80 border border-gray-200 dark:border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              DevPanel
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              data-testid="devpanel-close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-2 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Scenario List */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {scenarios.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                No scenarios available
              </div>
            ) : (
              scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900 dark:text-white text-sm">
                        {scenario.name}
                      </h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        {scenario.description}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {scenario.metadata.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => executeScenario(scenario.name)}
                    disabled={isLoading}
                    className="w-full mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm py-2 px-3 rounded transition-colors disabled:cursor-not-allowed"
                    data-testid={`execute-scenario-${scenario.name}`}
                  >
                    {isLoading ? "Executing..." : "Execute"}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer Info */}
          <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Mock mode enabled • {scenarios.length} scenario(s) available
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
