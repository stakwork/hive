import { useState, useCallback } from "react";
import { EnvironmentVariable } from "@/types/wizard";

type MergeStrategy = "replace" | "skip" | "merge";

interface UseEnvironmentVarsReturn {
  envVars: EnvironmentVariable[];
  handleEnvChange: (
    index: number,
    field: keyof EnvironmentVariable,
    value: string | boolean,
  ) => void;
  handleAddEnv: () => void;
  handleRemoveEnv: (index: number) => void;
  setEnvVars: (vars: EnvironmentVariable[]) => void;
  bulkAddEnvVars: (
    vars: Record<string, string>,
    strategy?: MergeStrategy
  ) => void;
}

export function useEnvironmentVars(
  initialVars?: EnvironmentVariable[],
): UseEnvironmentVarsReturn {
  const [envVars, setEnvVars] = useState<EnvironmentVariable[]>(
    initialVars || [{ name: "", value: "", show: false }],
  );

  const handleEnvChange = (
    index: number,
    field: keyof EnvironmentVariable,
    value: string | boolean,
  ) => {
    setEnvVars((prev) =>
      prev.map((pair, i) => (i === index ? { ...pair, [field]: value } : pair)),
    );
  };

  const handleAddEnv = () => {
    setEnvVars((prev) => [...prev, { name: "", value: "", show: false }]);
  };

  const handleRemoveEnv = (index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index));
  };

  const bulkAddEnvVars = useCallback(
    (vars: Record<string, string>, strategy: MergeStrategy = "merge") => {
      setEnvVars((prev) => {
        const existingKeys = new Set(prev.map((v) => v.name).filter(Boolean));
        const newVars: EnvironmentVariable[] = [];

        Object.entries(vars).forEach(([key, value]) => {
          if (!key) return;

          if (existingKeys.has(key)) {
            if (strategy === "replace") {
              // Update existing variable
              const index = prev.findIndex((v) => v.name === key);
              if (index !== -1) {
                prev[index].value = value;
              }
            }
            // For "skip" strategy, do nothing for existing keys
          } else {
            // Add new variable
            newVars.push({ name: key, value, show: false });
          }
        });

        // Remove empty placeholder if it exists
        const filtered = prev.filter((v) => v.name || v.value);

        if (strategy === "replace") {
          return [...filtered, ...newVars];
        }

        return [...filtered, ...newVars].length > 0
          ? [...filtered, ...newVars]
          : [{ name: "", value: "", show: false }];
      });
    },
    []
  );

  return {
    envVars,
    handleEnvChange,
    handleAddEnv,
    handleRemoveEnv,
    setEnvVars,
    bulkAddEnvVars,
  };
}
