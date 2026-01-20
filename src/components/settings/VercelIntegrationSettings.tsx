"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Copy, CopyCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface VercelIntegrationSettings {
  vercelApiToken: string | null;
  vercelTeamId: string | null;
  webhookUrl: string;
}

export function VercelIntegrationSettings() {
  const { workspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  
  const [apiToken, setApiToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  
  const [initialApiToken, setInitialApiToken] = useState("");
  const [initialTeamId, setInitialTeamId] = useState("");

  // Fetch existing settings
  useEffect(() => {
    const fetchSettings = async () => {
      if (!workspace?.slug) return;
      
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/workspaces/${workspace.slug}/settings/vercel-integration`
        );
        
        if (!response.ok) {
          if (response.status === 403) {
            toast.error("You don't have permission to view Vercel integration settings");
            return;
          }
          throw new Error("Failed to fetch Vercel integration settings");
        }
        
        const data: VercelIntegrationSettings = await response.json();
        
        // Set form values
        const token = data.vercelApiToken || "";
        const team = data.vercelTeamId || "";
        
        setApiToken(token);
        setTeamId(team);
        setWebhookUrl(data.webhookUrl);
        
        // Store initial values for change detection
        setInitialApiToken(token);
        setInitialTeamId(team);
      } catch (error) {
        console.error("Error fetching Vercel integration settings:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load Vercel integration settings"
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [workspace?.slug]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!workspace?.slug) return;
    
    // Validate API token is provided
    if (!apiToken.trim()) {
      toast.error("Vercel API token is required");
      return;
    }
    
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspace.slug}/settings/vercel-integration`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            vercelApiToken: apiToken.trim() || null,
            vercelTeamId: teamId.trim() || null,
          }),
        }
      );
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to save Vercel integration settings");
      }
      
      // Update initial values to reflect saved state
      setInitialApiToken(apiToken);
      setInitialTeamId(teamId);
      
      toast.success("Vercel integration settings saved successfully");
    } catch (error) {
      console.error("Error saving Vercel integration settings:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save Vercel integration settings"
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [workspace?.slug, apiToken, teamId]);

  // Handle copy webhook URL
  const handleCopyWebhookUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setIsCopied(true);
      toast.success("Webhook URL copied to clipboard");
      
      // Reset copied state after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Error copying to clipboard:", error);
      toast.error("Failed to copy webhook URL");
    }
  }, [webhookUrl]);

  // Check if settings have changed
  const hasChanges = useMemo(() => {
    return (
      apiToken !== initialApiToken ||
      teamId !== initialTeamId
    );
  }, [apiToken, initialApiToken, teamId, initialTeamId]);

  // Don't render if user doesn't have admin access
  if (!canAdmin) {
    return null;
  }

  if (!workspace) return null;

  return (
    <Card data-testid="vercel-integration-card">
      <CardHeader>
        <CardTitle>Vercel Integration</CardTitle>
        <CardDescription>
          Monitor production logs in real-time
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground" data-testid="vercel-integration-loading">
            Loading...
          </div>
        ) : (
          <>
            {/* API Token Input */}
            <div className="space-y-2">
              <Label htmlFor="vercel-api-token">
                Vercel API Token <span className="text-destructive">*</span>
              </Label>
              <Input
                id="vercel-api-token"
                data-testid="vercel-api-token-input"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Enter your Vercel API token"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Your API token will be encrypted and stored securely
              </p>
            </div>

            {/* Team ID Input */}
            <div className="space-y-2">
              <Label htmlFor="vercel-team-id">
                Team ID <span className="text-muted-foreground">(Optional)</span>
              </Label>
              <Input
                id="vercel-team-id"
                data-testid="vercel-team-id-input"
                type="text"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="Enter your Vercel team ID"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty for personal accounts
              </p>
            </div>

            {/* Webhook URL */}
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <div className="flex gap-2">
                <Input
                  id="webhook-url"
                  data-testid="vercel-webhook-url-input"
                  type="text"
                  value={webhookUrl}
                  readOnly
                  className="bg-muted"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  disabled={!webhookUrl}
                  title="Copy webhook URL"
                  data-testid="vercel-webhook-url-copy-button"
                >
                  {isCopied ? (
                    <CopyCheck className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Setup Instructions */}
            <div className="space-y-2">
              <Label>Setup Instructions</Label>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside" data-testid="vercel-setup-instructions">
                <li>Copy webhook URL</li>
                <li>Add to Vercel project settings → Log Drains</li>
                <li>Select NDJSON format</li>
                <li>Choose sources (Lambda, Edge, Static)</li>
              </ol>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4">
              <Button
                onClick={handleSave}
                disabled={isSubmitting || !hasChanges || !apiToken.trim()}
                data-testid="vercel-integration-save-button"
              >
                {isSubmitting ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
