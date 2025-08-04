import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SwarmData, FormSectionProps } from "../types";

export default function SwarmForm({
  data,
  errors,
  loading,
  onChange,
}: FormSectionProps<SwarmData>) {
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
        <Label htmlFor="swarmSecretAlias">Swarm API Key</Label>
        <Input
          id="swarmSecretAlias"
          type="text"
          placeholder="e.g. {{SWARM_123456_API_KEY}}"
          value={data.swarmSecretAlias}
          onChange={(e) =>
            handleInputChange("swarmSecretAlias", e.target.value)
          }
          className={errors.swarmSecretAlias ? "border-destructive" : ""}
          disabled={loading}
        />
        {errors.swarmSecretAlias && (
          <p className="text-sm text-destructive">{errors.swarmSecretAlias}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Your API key for authenticating with the Swarm service
        </p>
      </div>
    </div>
  );
}
