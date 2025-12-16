import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, Clipboard } from "lucide-react";
import { EnvironmentData, FormSectionProps } from "../types";
import { useEnvironmentVars } from "@/hooks/useEnvironmentVars";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { parseEnv } from "@/lib/env-parser";
import { toast } from "sonner";
import { useEffect, useState } from "react";

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
    bulkAddEnvVars,
  } = useEnvironmentVars();
  const [showImportSection, setShowImportSection] = useState(false);

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

  const handlePoolCpuChange = (value: string) => {
    onChange({ poolCpu: value });
  };

  const handlePoolMemoryChange = (value: string) => {
    onChange({ poolMemory: value });
  };

  const handlePasteEnv = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseEnv(text);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast.error("No variables found", { description: "The clipboard content doesn't contain valid environment variables." });
        return;
      }

      bulkAddEnvVars(parsed);
      toast.success("Variables imported", {
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''}.`,
      });
    } catch (err) {
      toast.error("Paste failed", { description: "Unable to read from clipboard. Please try again." });
    }
  };

  const handleFileContent = (content: string, fileName: string) => {
    try {
      const parsed = parseEnv(content);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast.error("No variables found", {
          description: `The file "${fileName}" doesn't contain valid environment variables.`,
        });
        return;
      }

      bulkAddEnvVars(parsed);
      toast.success("Variables imported", {
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''} from ${fileName}.`,
      });
      setShowImportSection(false);
    } catch (err) {
      toast.error("Import failed", { description: "Failed to parse the file. Please check the format." });
    }
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="poolCpu">CPU</Label>
          <Select
            value={data.poolCpu}
            onValueChange={handlePoolCpuChange}
            disabled={loading}
          >
            <SelectTrigger className={errors.poolCpu ? "border-destructive" : ""}>
              <SelectValue placeholder="Select CPU" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5 CPU</SelectItem>
              <SelectItem value="1">1 CPU</SelectItem>
              <SelectItem value="2">2 CPU</SelectItem>
              <SelectItem value="4">4 CPU</SelectItem>
              <SelectItem value="8">8 CPU</SelectItem>
            </SelectContent>
          </Select>
          {errors.poolCpu && (
            <p className="text-sm text-destructive">{errors.poolCpu}</p>
          )}
          <p className="text-xs text-muted-foreground">
            CPU allocation for tasks in this pool
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="poolMemory">Memory</Label>
          <Select
            value={data.poolMemory}
            onValueChange={handlePoolMemoryChange}
            disabled={loading}
          >
            <SelectTrigger className={errors.poolMemory ? "border-destructive" : ""}>
              <SelectValue placeholder="Select Memory" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1Gi">1 Gi</SelectItem>
              <SelectItem value="2Gi">2 Gi</SelectItem>
              <SelectItem value="4Gi">4 Gi</SelectItem>
              <SelectItem value="8Gi">8 Gi</SelectItem>
              <SelectItem value="16Gi">16 Gi</SelectItem>
            </SelectContent>
          </Select>
          {errors.poolMemory && (
            <p className="text-sm text-destructive">{errors.poolMemory}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Memory allocation for tasks in this pool
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h4 className="text-md font-medium">Environment Variables</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Add any ENV variables your Stakgraph integration needs. These will be
            included in your configuration.
          </p>
        </div>

        {/* Import section */}
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Quick import:</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePasteEnv}
              disabled={loading}
              className="h-7"
            >
              <Clipboard className="w-3.5 h-3.5 mr-1.5" />
              Paste ENVs
            </Button>
            <span className="text-muted-foreground">or</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowImportSection(!showImportSection)}
              disabled={loading}
              className="h-7"
            >
              File import
            </Button>
          </div>

          {showImportSection && (
            <div className="mt-3 animate-in fade-in-0 slide-in-from-top-2 duration-200">
              <FileDropZone
                onFileContent={handleFileContent}
                disabled={loading}
                className="max-w-full"
              />
            </div>
          )}
        </div>

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
