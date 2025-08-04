import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { EnvironmentData, FormSectionProps } from "../types";
import { useEnvironmentVars } from "@/hooks/useEnvironmentVars";
import { useEffect } from "react";

interface EnvironmentFormProps extends FormSectionProps<EnvironmentData> {
  onEnvVarsChange: (
    envVars: Array<{ name: string; value: string; show?: boolean }>,
  ) => void;
}

export default function EnvironmentForm({
  data,
  errors,
  loading,
  onChange,
  onEnvVarsChange,
}: EnvironmentFormProps) {
  const {
    envVars,
    handleEnvChange,
    handleAddEnv,
    handleRemoveEnv,
    setEnvVars,
  } = useEnvironmentVars();

  // Sync environment variables when data changes
  useEffect(() => {
    if (data.environmentVariables && Array.isArray(data.environmentVariables)) {
      setEnvVars(
        data.environmentVariables.map((env) => ({
          name: env.name,
          value: env.value,
          show: false,
        })),
      );
    }
  }, [data.environmentVariables, setEnvVars]);

  // Notify parent when envVars change
  useEffect(() => {
    onEnvVarsChange(envVars);
  }, [envVars, onEnvVarsChange]);

  const handlePoolNameChange = (value: string) => {
    onChange({ poolName: value });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold mb-2">Environment</h3>

      <div className="space-y-2">
        <Label htmlFor="poolName">Pool Name</Label>
        <Input
          id="poolName"
          placeholder="Enter the pool name"
          value={data.poolName}
          onChange={(e) => handlePoolNameChange(e.target.value)}
          className={errors.poolName ? "border-destructive" : ""}
          disabled={loading}
        />
        {errors.poolName && (
          <p className="text-sm text-destructive">{errors.poolName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          The name of the pool to use for your Stakgraph configuration
        </p>
      </div>

      <div className="space-y-3">
        <h4 className="text-md font-medium">Environment Variables</h4>
        <p className="text-xs text-muted-foreground">
          Add any ENV variables your Stakgraph integration needs. These will be
          included in your configuration.
        </p>
        <div className="space-y-2">
          {envVars.map((pair, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <Input
                placeholder="KEY"
                value={pair.name}
                onChange={(e) => handleEnvChange(idx, "name", e.target.value)}
                className="w-1/3"
                disabled={loading}
              />
              <div className="relative w-1/2 flex items-center">
                <Input
                  placeholder="VALUE"
                  type={pair.show ? "text" : "password"}
                  value={pair.value}
                  onChange={(e) =>
                    handleEnvChange(idx, "value", e.target.value)
                  }
                  className="pr-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  onClick={() => handleEnvChange(idx, "show", !pair.show)}
                  tabIndex={-1}
                  disabled={loading}
                >
                  {pair.show ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleRemoveEnv(idx)}
                className="px-2"
                disabled={envVars.length === 1 || loading}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={handleAddEnv}
            className="mt-2"
            disabled={loading}
          >
            Add Variable
          </Button>
        </div>
      </div>
    </div>
  );
}
