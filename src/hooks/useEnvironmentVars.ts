import { useState } from "react";
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

  return {
    envVars,
    handleEnvChange,
    handleAddEnv,
    handleRemoveEnv,
    setEnvVars,
  };
}
