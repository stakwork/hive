import { useState, useCallback } from "react";
import { EnvironmentVariable } from "@/types/wizard";

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
  bulkAddEnvVars: (vars: Record<string, string>) => void;
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

  const bulkAddEnvVars = useCallback((vars: Record<string, string>) => {
    setEnvVars((prev) => {
      const existingKeys = new Set(prev.map((v) => v.name).filter(Boolean));
      const newVars: EnvironmentVariable[] = [];
      const updatedPrev = [...prev];

      Object.entries(vars).forEach(([key, value]) => {
        if (!key) return;

        if (existingKeys.has(key)) {
          // Update existing variable
          const index = updatedPrev.findIndex((v) => v.name === key);
          if (index !== -1) {
            updatedPrev[index] = { ...updatedPrev[index], value };
          }
        } else {
          // Add new variable
          newVars.push({ name: key, value, show: false });
        }
      });

      // Remove empty placeholder if it exists
      const filtered = updatedPrev.filter((v) => v.name || v.value);

      return [...filtered, ...newVars].length > 0
        ? [...filtered, ...newVars]
        : [{ name: "", value: "", show: false }];
    });
  }, []);

  return {
    envVars,
    handleEnvChange,
    handleAddEnv,
    handleRemoveEnv,
    setEnvVars,
    bulkAddEnvVars,
  };
}
