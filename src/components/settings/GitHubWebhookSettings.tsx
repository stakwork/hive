"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { AlertCircle, Check, Copy, ExternalLink, Webhook } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface WebhookStatus {
  webhookUrl: string;
  isConfigured: boolean;
  lastWebhookReceived: string | null;
  recentDeploymentsCount: number;
}

export function GitHubWebhookSettings() {
  const { id: workspaceId, slug } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!canAdmin || !slug) return;

    const fetchWebhookStatus = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/workspaces/${slug}/settings/github-webhook`);
        if (response.ok) {
          const data = await response.json();
          setWebhookStatus(data);
        }
      } catch (error) {
        console.error("Error fetching webhook status:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchWebhookStatus();
  }, [slug, canAdmin]);

  if (!canAdmin) {
    return null;
  }

  const handleCopy = async () => {
    if (!webhookStatus?.webhookUrl) return;

    try {
      await navigator.clipboard.writeText(webhookStatus.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy webhook URL:", error);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            GitHub Deployment Webhook
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading webhook status...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          GitHub Deployment Webhook
        </CardTitle>
        <CardDescription>
          Configure GitHub webhooks to track deployment status for tasks in this workspace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          {webhookStatus?.isConfigured ? (
            <Badge variant="default" className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              Configured
            </Badge>
          ) : (
            <Badge variant="secondary" className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Not Configured
            </Badge>
          )}
        </div>

        {/* Webhook URL */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Webhook URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={webhookStatus?.webhookUrl || ""}
              readOnly
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              title="Copy webhook URL"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Recent Activity */}
        {webhookStatus?.isConfigured && (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="font-medium">Recent deployments (last 7 days):</span>{" "}
              <span className="text-muted-foreground">{webhookStatus.recentDeploymentsCount}</span>
            </div>
            {webhookStatus.lastWebhookReceived && (
              <div className="text-sm text-muted-foreground">
                Last webhook received:{" "}
                {new Date(webhookStatus.lastWebhookReceived).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* Setup Instructions */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-3">
            <div className="font-medium">How to configure GitHub webhooks:</div>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>
                Go to your GitHub repository's <strong>Settings → Webhooks → Add webhook</strong>
              </li>
              <li>
                Paste the webhook URL above into the <strong>Payload URL</strong> field
              </li>
              <li>
                Set <strong>Content type</strong> to <code className="px-1 py-0.5 bg-muted rounded">application/json</code>
              </li>
              <li>
                Under <strong>"Which events would you like to trigger this webhook?"</strong>, select:{" "}
                <strong>Let me select individual events</strong>
              </li>
              <li>
                Check only: <strong>Deployment statuses</strong>
              </li>
              <li>
                Ensure <strong>Active</strong> is checked, then click <strong>Add webhook</strong>
              </li>
            </ol>
            <div className="text-sm pt-2">
              <a
                href="https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                View GitHub webhook documentation
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </AlertDescription>
        </Alert>

        {!webhookStatus?.isConfigured && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Once configured, deployment status badges will automatically appear on tasks when code is deployed to staging or production.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
