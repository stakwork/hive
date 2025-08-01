"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Loader2,
  Shield,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface GitHubAppLinkProps {
  repositoryFullName: string;
  repositoryName: string;
  onInstallationComplete?: (installationId: number) => void;
  trigger?: React.ReactNode;
  className?: string;
}

interface InstallationStatus {
  installed: boolean;
  installationId?: number;
  installationUrl: string;
  repository: string;
  accountType?: "User" | "Organization";
  accountLogin?: string;
  repositoryOwner: string;
  needsUserInstallation?: boolean;
  availableInstallations?: Array<{
    id: number;
    accountLogin: string;
    accountType: "User" | "Organization";
  }>;
}

export function GitHubAppLink({
  repositoryFullName,
  repositoryName,
  onInstallationComplete,
  trigger,
  className = "",
}: GitHubAppLinkProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [installationStatus, setInstallationStatus] =
    useState<InstallationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const checkInstallationStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/github/app/installation-status?repository=${encodeURIComponent(repositoryFullName)}`,
      );

      if (!response.ok) {
        throw new Error("Failed to check installation status");
      }

      const data = await response.json();
      setInstallationStatus(data);
    } catch (err) {
      console.error("Error checking installation status:", err);
      setError("Failed to check GitHub App installation status");
    } finally {
      setIsLoading(false);
    }
  }, [repositoryFullName]);

  // Check installation status when dialog opens
  useEffect(() => {
    if (isDialogOpen && !installationStatus) {
      checkInstallationStatus();
    }
  }, [isDialogOpen, installationStatus, checkInstallationStatus]);

  const handleInstallApp = () => {
    if (!installationStatus?.installationUrl) return;

    // Open GitHub App installation page in a popup
    const popup = window.open(
      installationStatus.installationUrl,
      "github-app-install",
      "width=600,height=700,scrollbars=yes,resizable=yes",
    );

    if (!popup) {
      // Fallback: redirect in the same window
      window.location.href = installationStatus.installationUrl;
      return;
    }

    // Poll for popup closure or message
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        // Re-check installation status after popup closes
        setTimeout(() => {
          checkInstallationStatus();
        }, 1000);
      }
    }, 1000);

    // Listen for messages from the popup (if we implement a callback page)
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (
        event.data.type === "github-app-installed" &&
        event.data.installationId
      ) {
        clearInterval(checkClosed);
        popup.close();
        window.removeEventListener("message", handleMessage);

        // Update status and trigger callback
        setInstallationStatus((prev) =>
          prev
            ? {
                ...prev,
                installed: true,
                installationId: event.data.installationId,
              }
            : null,
        );

        if (onInstallationComplete) {
          onInstallationComplete(event.data.installationId);
        }
      } else if (event.data.type === "github-app-requested") {
        // Installation was requested but needs approval
        clearInterval(checkClosed);
        popup.close();
        window.removeEventListener("message", handleMessage);

        // Re-check installation status
        setTimeout(() => {
          checkInstallationStatus();
        }, 1000);
      }
    };

    window.addEventListener("message", handleMessage);

    // Cleanup after 5 minutes
    setTimeout(
      () => {
        clearInterval(checkClosed);
        window.removeEventListener("message", handleMessage);
        if (!popup.closed) {
          popup.close();
        }
      },
      5 * 60 * 1000,
    );
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span>Checking installation status...</span>
        </div>
      );
    }

    if (error) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }

    if (!installationStatus) {
      return (
        <div className="text-center py-8">
          <p className="text-muted-foreground">
            Unable to check installation status
          </p>
        </div>
      );
    }

    if (installationStatus.installed) {
      return (
        <div className="text-center py-8">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Repository Connected!</h3>
          <p className="text-muted-foreground mb-4">
            The GitHub App is installed for <strong>{repositoryName}</strong>{" "}
            via{" "}
            <strong>
              {installationStatus.accountType === "Organization"
                ? "org"
                : "user"}
              : {installationStatus.accountLogin}
            </strong>
            . We can now generate tokens to push code to this repository.
          </p>
          <div className="flex justify-center gap-2 mb-4">
            <Badge
              variant="secondary"
              className="bg-green-50 text-green-700 border-green-200"
            >
              <Shield className="w-3 h-3 mr-1" />
              App Installed
            </Badge>
            <Badge
              variant={
                installationStatus.accountType === "User"
                  ? "default"
                  : "secondary"
              }
              className={
                installationStatus.accountType === "User"
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-purple-50 text-purple-700 border-purple-200"
              }
            >
              {installationStatus.accountType === "User"
                ? "User"
                : "Organization"}
            </Badge>
          </div>
          {installationStatus.availableInstallations &&
            installationStatus.availableInstallations.length > 1 && (
              <div className="text-xs text-muted-foreground">
                <p>Available installations:</p>
                <div className="flex justify-center gap-1 mt-1">
                  {installationStatus.availableInstallations.map((inst) => (
                    <Badge key={inst.id} variant="outline" className="text-xs">
                      {inst.accountType === "User" ? "👤" : "🏢"}{" "}
                      {inst.accountLogin}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
        </div>
      );
    }

    return (
      <div className="py-6">
        <div className="text-center mb-6">
          <GitBranch className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Connect Repository</h3>
          <p className="text-muted-foreground">
            Install our GitHub App to enable automated code deployment for{" "}
            <strong>{repositoryName}</strong>.
          </p>
        </div>

        {installationStatus.needsUserInstallation && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>User Installation Required</strong>
              <br />
              The app is installed on your organization but needs to be
              installed on your user account (
              <strong>{installationStatus.repositoryOwner}</strong>) to access
              this repository.
            </AlertDescription>
          </Alert>
        )}

        {installationStatus.availableInstallations &&
          installationStatus.availableInstallations.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium mb-2">Current installations:</p>
              <div className="flex flex-wrap gap-2">
                {installationStatus.availableInstallations.map((inst) => (
                  <Badge key={inst.id} variant="outline" className="text-xs">
                    {inst.accountType === "User" ? "👤" : "🏢"}{" "}
                    {inst.accountLogin}
                  </Badge>
                ))}
              </div>
            </div>
          )}

        <div className="space-y-4 mb-6">
          <div className="border rounded-lg p-4 bg-muted/50">
            <h4 className="font-medium mb-2">What this enables:</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• Generate secure access tokens for repository operations</li>
              <li>• Automatically push generated code to your repository</li>
              <li>• Create pull requests with AI-generated changes</li>
              <li>• Trigger GitHub Actions workflows</li>
            </ul>
          </div>

          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              The app only requests the minimum permissions needed and you can
              revoke access at any time from your GitHub settings.
            </AlertDescription>
          </Alert>
        </div>

        <Button onClick={handleInstallApp} className="w-full" size="lg">
          <ExternalLink className="w-4 h-4 mr-2" />
          {installationStatus.needsUserInstallation
            ? `Install on User Account (${installationStatus.repositoryOwner})`
            : "Install GitHub App"}
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className={className}>
            <GitBranch className="w-4 h-4 mr-2" />
            Connect to GitHub App
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>GitHub App Integration</DialogTitle>
          <DialogDescription>
            Connect your repository to enable advanced GitHub features.
          </DialogDescription>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
