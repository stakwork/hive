"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export default function GitHubAppCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");

    if (setupAction === "install" && installationId) {
      // Installation was successful
      try {
        // Send message to parent window
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            {
              type: "github-app-installed",
              installationId: parseInt(installationId),
            },
            window.location.origin,
          );
        }

        // Close the popup after a short delay
        setTimeout(() => {
          window.close();
        }, 2000);
      } catch (error) {
        console.error("Error sending message to parent:", error);
        // Still try to close the window
        setTimeout(() => {
          window.close();
        }, 3000);
      }
    } else if (setupAction === "request") {
      // Installation was requested but needs approval
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            {
              type: "github-app-requested",
              installationId: installationId ? parseInt(installationId) : null,
            },
            window.location.origin,
          );
        }

        setTimeout(() => {
          window.close();
        }, 3000);
      } catch (error) {
        console.error("Error sending message to parent:", error);
        setTimeout(() => {
          window.close();
        }, 3000);
      }
    } else {
      // No specific action, just close after a delay
      setTimeout(() => {
        window.close();
      }, 1000);
    }
  }, [searchParams]);

  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");

  const renderContent = () => {
    if (setupAction === "install" && installationId) {
      return (
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">
            Installation Successful!
          </h1>
          <p className="text-muted-foreground mb-4">
            The GitHub App has been successfully installed.
          </p>
          <p className="text-sm text-muted-foreground">
            This window will close automatically...
          </p>
        </div>
      );
    }

    if (setupAction === "request") {
      return (
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Installation Requested</h1>
          <p className="text-muted-foreground mb-4">
            Your GitHub App installation request has been submitted and is
            pending approval.
          </p>
          <p className="text-sm text-muted-foreground">
            This window will close automatically...
          </p>
        </div>
      );
    }

    return (
      <div className="text-center">
        <Loader2 className="w-16 h-16 animate-spin mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2">Processing...</h1>
        <p className="text-muted-foreground">
          Processing your GitHub App installation...
        </p>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">GitHub App Installation</CardTitle>
        </CardHeader>
        <CardContent>{renderContent()}</CardContent>
      </Card>
    </div>
  );
}
