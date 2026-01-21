"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Copy, Eye, EyeOff, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

interface VercelIntegrationData {
  vercelApiToken: string | null;
  vercelTeamId: string | null;
  webhookUrl: string;
}

export function VercelIntegrationSettings() {
  const { workspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Form state
  const [vercelApiToken, setVercelApiToken] = useState("");
  const [vercelTeamId, setVercelTeamId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  // Track original values to detect changes
  const [originalToken, setOriginalToken] = useState("");
  const [originalTeamId, setOriginalTeamId] = useState("");

  // Fetch current settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      if (!workspace?.slug) return;

      setIsLoading(true);
      try {
        const response = await fetch(`/api/workspaces/${workspace.slug}/settings/vercel-integration`);

        if (!response.ok) {
          if (response.status === 403) {
            // User doesn't have admin access, silently handle
            return;
          }
          throw new Error("Failed to fetch Vercel integration settings");
        }

        const data: VercelIntegrationData = await response.json();

        setVercelApiToken(data.vercelApiToken || "");
        setVercelTeamId(data.vercelTeamId || "");
        setWebhookUrl(data.webhookUrl || "");

        // Store original values
        setOriginalToken(data.vercelApiToken || "");
        setOriginalTeamId(data.vercelTeamId || "");
      } catch (error) {
        console.error("Error fetching Vercel integration settings:", error);
        toast.error("Failed to load Vercel integration settings");
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [workspace?.slug]);

  const handleCopyWebhookUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopySuccess(true);
      toast.success("Webhook URL copied to clipboard");
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Failed to copy webhook URL");
    }
  }, [webhookUrl]);

  const handleSave = useCallback(async () => {
    if (!workspace?.slug) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/settings/vercel-integration`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vercelApiToken: vercelApiToken || null,
          vercelTeamId: vercelTeamId || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save settings");
      }

      // Update original values after successful save
      setOriginalToken(vercelApiToken);
      setOriginalTeamId(vercelTeamId);

      toast.success("Vercel integration settings saved successfully");
    } catch (error) {
      console.error("Error saving Vercel integration settings:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setIsSubmitting(false);
    }
  }, [workspace?.slug, vercelApiToken, vercelTeamId]);

  // Check if there are changes to save
  const hasChanges = vercelApiToken !== originalToken || vercelTeamId !== originalTeamId;

  if (!workspace) return null;

  // Only show to users with admin access
  if (!canAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vercel Integration</CardTitle>
        <CardDescription>Monitor production logs in real-time by connecting your Vercel account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Vercel API Token */}
            <div className="space-y-2">
              <Label htmlFor="vercel-api-token">Vercel API Token</Label>
              <div className="relative">
                <Input
                  id="vercel-api-token"
                  type={showToken ? "text" : "password"}
                  value={vercelApiToken}
                  onChange={(e) => setVercelApiToken(e.target.value)}
                  placeholder="Enter your Vercel API token"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowToken(!showToken)}
                  tabIndex={-1}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Create a token at{" "}
                <a
                  href="https://vercel.com/account/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  vercel.com/account/tokens
                </a>
              </p>
            </div>

            {/* Vercel Team ID */}
            <div className="space-y-2">
              <Label htmlFor="vercel-team-id">Vercel Team ID (optional)</Label>
              <Input
                id="vercel-team-id"
                type="text"
                value={vercelTeamId}
                onChange={(e) => setVercelTeamId(e.target.value)}
                placeholder="team_xxxxx"
              />
              <p className="text-sm text-muted-foreground">
                Required if using a team account. Find it in your team settings.
              </p>
            </div>

            {/* Webhook URL */}
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <div className="flex gap-2">
                <Input
                  id="webhook-url"
                  type="text"
                  value={webhookUrl}
                  readOnly
                  className="bg-muted font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  disabled={!webhookUrl}
                >
                  {copySuccess ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Setup Instructions */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <h4 className="font-medium mb-2">Setup Instructions</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>Copy the webhook URL above</li>
                <li>Go to your Vercel project settings → Integrations → Log Drains</li>
                <li>Add a new log drain with the webhook URL</li>
                <li>Select the log types you want to receive</li>
              </ol>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isSubmitting || !hasChanges}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
