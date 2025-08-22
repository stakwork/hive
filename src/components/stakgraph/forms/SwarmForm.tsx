import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SwarmData, FormSectionProps } from "../types";
import { Key } from "lucide-react";

export default function SwarmForm({
  data,
  errors,
  loading,
  onChange,
}: FormSectionProps<SwarmData>) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);

  const handleInputChange = (field: keyof SwarmData, value: string) => {
    onChange({ [field]: value });
    if (field === "swarmApiKey") {
      setApiKeyTouched(true);
    }
  };

  const toggleKeyView = () => {
    setShowApiKey(!showApiKey);
    if (!showApiKey) {
      setApiKeyTouched(false); // Reset when switching to API key view
    }
  };

  const handleApiKeyFocus = () => {
    if (showApiKey) {
      setApiKeyTouched(true);
    }
  };

  // Show visual dots if we're in API key mode, field hasn't been touched, and there's no actual value
  const showVisualDots = showApiKey && !apiKeyTouched && (!data.swarmApiKey || data.swarmApiKey === "");
  const displayValue = showVisualDots ? "••••••••••••••••" : (showApiKey ? (data.swarmApiKey || "") : (data.swarmSecretAlias || ""));

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold mb-2">Swarm</h3>

      <div className="space-y-2">
        <Label htmlFor="swarmUrl">Swarm URL</Label>
        <Input
          id="swarmUrl"
          type="url"
          placeholder="https://your-swarm-instance.sphinx.chat/api"
          value={data.swarmUrl}
          onChange={(e) => handleInputChange("swarmUrl", e.target.value)}
          className={errors.swarmUrl ? "border-destructive" : ""}
          disabled={loading}
        />
        {errors.swarmUrl && (
          <p className="text-sm text-destructive">{errors.swarmUrl}</p>
        )}
        <p className="text-xs text-muted-foreground">
          The base URL of your Swarm instance
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={showApiKey ? "swarmApiKey" : "swarmSecretAlias"}>
          {showApiKey ? "Swarm Api Key" : "Swarm Secret Alias"}
        </Label>
        <div className="relative">
          <Input
            key={showApiKey ? "swarmApiKey" : "swarmSecretAlias"}
            id={showApiKey ? "swarmApiKey" : "swarmSecretAlias"}
            type={showApiKey ? "password" : "text"}
            placeholder={
              showApiKey
                ? "Enter your actual API key to update"
                : "e.g. {{SWARM_123456_API_KEY}}"
            }
            value={displayValue}
            onChange={(e) =>
              handleInputChange(
                showApiKey ? "swarmApiKey" : "swarmSecretAlias",
                e.target.value
              )
            }
            onFocus={showApiKey ? handleApiKeyFocus : undefined}
            className={
              errors.swarmSecretAlias || errors.swarmApiKey
                ? "border-destructive pr-10"
                : "pr-10"
            }
            disabled={loading}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
            onClick={toggleKeyView}
          >
            <Key className="h-4 w-4" />
          </Button>
        </div>
        {(errors.swarmSecretAlias || errors.swarmApiKey) && (
          <p className="text-sm text-destructive">
            {showApiKey ? errors.swarmApiKey : errors.swarmSecretAlias}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {showApiKey
            ? "Your actual API key for authenticating with the Swarm service (write-only)"
            : "The secret alias reference for your Swarm API key"}
        </p>
      </div>
    </div>
  );
}
