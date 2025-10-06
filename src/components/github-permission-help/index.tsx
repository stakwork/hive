"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { AlertTriangle, ExternalLink, RefreshCw, Settings } from "lucide-react";
import { useState } from "react";

interface GitHubPermissionHelpProps {
  repositoryUrl?: string;
  onRetry?: () => void;
}

export function GitHubPermissionHelp({
  repositoryUrl,
  onRetry
}: GitHubPermissionHelpProps) {
  const { slug } = useWorkspace();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      if (onRetry) {
        await onRetry();
      } else {
        // Refresh the page to restart the flow
        window.location.reload();
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReinstall = async () => {
    if (!slug || !repositoryUrl) return;

    try {
      const response = await fetch("/api/github/app/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceSlug: slug,
          repositoryUrl: repositoryUrl
        }),
      });

      const data = await response.json();

      if (data.success && data.data?.link) {
        // Redirect to GitHub App installation
        window.location.href = data.data.link;
      } else {
        console.error('Failed to generate installation link:', data);
      }
    } catch (error) {
      console.error('Error generating installation link:', error);
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <CardTitle className="text-lg">GitHub Permissions Required</CardTitle>
        </div>
        <CardDescription>
          Your workspace needs push permissions to the repository to function properly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <div>
            <div className="font-medium mb-1">Push Permissions Required</div>
            <AlertDescription>
              Your GitHub App installation only has read access to the repository.
              Push permissions are required to create pull requests, make commits, and sync changes.
            </AlertDescription>
          </div>
        </Alert>

        <div className="space-y-4">
          <h4 className="font-semibold text-sm">How to fix this:</h4>

          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 p-3 border rounded-lg">
              <div className="bg-blue-100 text-blue-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">1</div>
              <div>
                <p className="font-medium mb-1">Reinstall the GitHub App</p>
                <p className="text-muted-foreground">Click the button below to reinstall the GitHub App with proper permissions.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 border rounded-lg">
              <div className="bg-blue-100 text-blue-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">2</div>
              <div>
                <p className="font-medium mb-1">Grant Repository Access</p>
                <p className="text-muted-foreground">When prompted, select the repository and ensure "Write" permissions are granted.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 border rounded-lg">
              <div className="bg-blue-100 text-blue-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">3</div>
              <div>
                <p className="font-medium mb-1">Complete Installation</p>
                <p className="text-muted-foreground">After installation, you'll be redirected back to continue setup.</p>
              </div>
            </div>
          </div>
        </div>

        {repositoryUrl && (
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 mb-1">Repository:</p>
            <code className="text-sm font-mono">{repositoryUrl}</code>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            onClick={handleReinstall}
            disabled={!slug || !repositoryUrl}
            className="flex-1"
          >
            <Settings className="w-4 h-4 mr-2" />
            Reinstall GitHub App
            <ExternalLink className="w-4 h-4 ml-2" />
          </Button>

          <Button
            variant="outline"
            onClick={handleRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Check Again
          </Button>
        </div>

        <div className="text-xs text-muted-foreground pt-2 border-t">
          <p>
            <strong>Note:</strong> If you're not an admin of the repository or organization,
            you may need to request permissions from an administrator.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}