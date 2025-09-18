import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Clipboard, AlertCircle } from "lucide-react";
import { useWizardStore } from "@/stores/useWizardStore";
import { useCallback, useEffect, useState } from "react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { parseEnv } from "@/lib/env-parser";
import { useToast } from "@/components/ui/use-toast";

interface EnvironmentSetupStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function EnvironmentSetupStep({
  onNext,
  onBack,
}: EnvironmentSetupStepProps) {
  const services = useWizardStore((s) => s.services);
  const setEnvVars = useWizardStore((s) => s.setEnvVars);
  const envVars = useWizardStore((s) => s.envVars);
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const [loading, setLoading] = useState(false);
  const [localVars, setLocalVars] = useState<{ name: string; value: string }[]>(
    [],
  );
  const [showImportSection, setShowImportSection] = useState(false);
  const { toast } = useToast();

  // Initialize from services[*].env
  useEffect(() => {
    if (envVars?.length > 0) {
      setLocalVars(envVars);
      return;
    }
    const collectedVars: { name: string; value: string }[] = [];
    services.forEach((service) => {
      Object.entries(service.env || {}).forEach(([key, value]) => {
        collectedVars.push({ name: key, value });
      });
    });
    setLocalVars(
      collectedVars.length > 0 ? collectedVars : [{ name: "", value: "" }],
    );
  }, [services, envVars]);

  const handleChange = (
    index: number,
    field: "name" | "value",
    value: string,
  ) => {
    setLocalVars((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleAdd = () => {
    setLocalVars((prev) => [...prev, { name: "", value: "" }]);
  };

  const handleRemove = (index: number) => {
    setLocalVars((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePasteEnv = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseEnv(text);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast({
          title: "No variables found",
          description: "The clipboard content doesn't contain valid environment variables.",
          variant: "destructive",
        });
        return;
      }

      // Merge with existing vars
      const newVars = Object.entries(parsed).map(([name, value]) => ({ name, value }));
      setLocalVars(prev => {
        const existingKeys = new Set(prev.map(v => v.name).filter(Boolean));
        const filtered = prev.filter(v => v.name || v.value);
        const toAdd = newVars.filter(v => !existingKeys.has(v.name));
        return [...filtered, ...toAdd].length > 0 ? [...filtered, ...toAdd] : [{ name: "", value: "" }];
      });

      toast({
        title: "Variables imported",
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''}.`,
      });
    } catch (err) {
      toast({
        title: "Paste failed",
        description: "Unable to read from clipboard. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleFileContent = (content: string, fileName: string) => {
    try {
      const parsed = parseEnv(content);

      const count = Object.keys(parsed).length;
      if (count === 0) {
        toast({
          title: "No variables found",
          description: `The file "${fileName}" doesn't contain valid environment variables.`,
          variant: "destructive",
        });
        return;
      }

      // Merge with existing vars
      const newVars = Object.entries(parsed).map(([name, value]) => ({ name, value }));
      setLocalVars(prev => {
        const existingKeys = new Set(prev.map(v => v.name).filter(Boolean));
        const filtered = prev.filter(v => v.name || v.value);
        const toAdd = newVars.filter(v => !existingKeys.has(v.name));
        return [...filtered, ...toAdd].length > 0 ? [...filtered, ...toAdd] : [{ name: "", value: "" }];
      });

      toast({
        title: "Variables imported",
        description: `Successfully imported ${count} environment variable${count > 1 ? 's' : ''} from ${fileName}.`,
      });
      setShowImportSection(false);
    } catch (err) {
      toast({
        title: "Import failed",
        description: "Failed to parse the file. Please check the format.",
        variant: "destructive",
      });
    }
  };

  const handleNext = useCallback(async () => {
    const cleaned = localVars
      .filter((v) => v.name.trim() !== "")
      .map(({ name, value }) => ({ name: name.trim(), value }));
    setEnvVars(cleaned);
    try {
      await fetch("/api/swarm", {
        method: "PUT",
        body: JSON.stringify({
          envVars: cleaned,
          workspaceId: workspaceId,
        }),
      });

      onNext();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [onNext, services, workspaceId, localVars, setEnvVars]);

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="18" y="28" width="28" height="24" rx="6" fill="#F59E42">
              <animate
                attributeName="fill"
                values="#F59E42;#FBBF24;#F59E42"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </rect>
            <path
              d="M24 28v-6a8 8 0 0 1 16 0v6"
              stroke="#FBBF24"
              strokeWidth="3"
              fill="none"
            >
              <animate
                attributeName="stroke"
                values="#FBBF24;#F59E42;#FBBF24"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </path>
            <circle cx="32" cy="40" r="3" fill="#fff">
              <animate
                attributeName="r"
                values="3;5;3"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
        </div>
        <CardTitle className="text-2xl">Setting up code environment</CardTitle>
        <CardDescription>
          Add any ENV variables your code environment needs.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Import section with better styling */}
        <div className="border-b pb-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
            <span>Quick import:</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePasteEnv}
              className="h-8"
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
              className="h-8"
            >
              File import
            </Button>
          </div>

          {showImportSection && (
            <div className="animate-in fade-in-0 slide-in-from-top-2 duration-200">
              <FileDropZone
                onFileContent={handleFileContent}
                className="max-w-full"
              />
              <div className="mt-2 text-xs text-muted-foreground flex items-start gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Supports .env files with KEY=VALUE format.</span>
              </div>
            </div>
          )}
        </div>

        {localVars.map((env, idx) => (
          <div key={idx} className="flex gap-2 items-center">
            <Input
              placeholder="KEY"
              value={env.name}
              onChange={(e) => handleChange(idx, "name", e.target.value)}
              className="w-1/3"
            />
            <Input
              placeholder="VALUE"
              value={env.value}
              onChange={(e) => handleChange(idx, "value", e.target.value)}
              className="w-1/2"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => handleRemove(idx)}
              className="px-2"
              disabled={localVars.length === 1}
            >
              Remove
            </Button>
          </div>
        ))}

        <Button type="button" variant="secondary" onClick={handleAdd}>
          Add Variable
        </Button>

        <div className="flex justify-between pt-4">
          <Button variant="outline" type="button" onClick={onBack}>
            Back
          </Button>
          <Button
            disabled={loading}
            className="px-8 bg-green-600 hover:bg-green-700"
            type="button"
            onClick={handleNext}
          >
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
