import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { SwarmData, FormSectionProps } from "../types";

export default function SwarmForm({
  data,
  errors,
  loading,
  onChange,
}: FormSectionProps<SwarmData>) {
  const [showApiKey, setShowApiKey] = useState(false);

  const handleInputChange = (field: keyof SwarmData, value: string) => {
    onChange({ [field]: value });
  };

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
        <Label htmlFor="swarmApiKey">Swarm API Key</Label>
        <div className="relative">
          <Input
            id="swarmApiKey"
            type={showApiKey ? "text" : "password"}
            placeholder="Enter your Swarm API key"
            value={data.swarmApiKey || ""}
            onChange={(e) => handleInputChange("swarmApiKey", e.target.value)}
            className={errors.swarmApiKey ? "border-destructive pr-10" : "pr-10"}
            disabled={loading}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
            onClick={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
        {errors.swarmApiKey && (
          <p className="text-sm text-destructive">{errors.swarmApiKey}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Your actual API key for authenticating with the Swarm service
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="swarmSecretAlias">Swarm Secret Alias</Label>
        <Input
          id="swarmSecretAlias"
          type="text"
          placeholder="e.g. {{SWARM_123456_API_KEY}}"
          value={data.swarmSecretAlias || ""}
          onChange={(e) => handleInputChange("swarmSecretAlias", e.target.value)}
          className={errors.swarmSecretAlias ? "border-destructive" : ""}
          disabled={loading}
        />
        {errors.swarmSecretAlias && (
          <p className="text-sm text-destructive">{errors.swarmSecretAlias}</p>
        )}
        <p className="text-xs text-muted-foreground">
          The secret alias reference for your Swarm API key (used in environment variables)
        </p>
      </div>
    </div>
  );
}