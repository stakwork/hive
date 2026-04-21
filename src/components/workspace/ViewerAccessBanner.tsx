"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Clock, Eye } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { useSession } from "next-auth/react";

type RequestState = "idle" | "loading" | "pending";

export function ViewerAccessBanner() {
  const { slug, role, refreshCurrentWorkspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const { status } = useSession();
  const [requestState, setRequestState] = useState<RequestState>("idle");

  // Only show for authenticated viewers who cannot write
  if (status !== "authenticated" || canWrite || role === null) return null;

  const handleRequestAccess = async () => {
    if (!slug || requestState !== "idle") return;
    setRequestState("loading");

    try {
      const res = await fetch(`/api/workspaces/${slug}/access-request`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Request failed");
      }

      const data = await res.json();

      if (data.status === "auto_approved" || data.status === "already_developer") {
        toast.success("You've been granted developer access!");
        await refreshCurrentWorkspace();
      } else {
        setRequestState("pending");
      }
    } catch {
      setRequestState("idle");
      toast.error("Failed to send access request. Please try again.");
    }
  };

  return (
    <Alert className="rounded-none border-x-0 border-t-0 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
      <Eye className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <AlertDescription className="flex items-center justify-between w-full">
        <span className="text-amber-800 dark:text-amber-300">
          You&apos;re viewing in read-only mode.
        </span>
        {requestState === "pending" ? (
          <Button variant="outline" size="sm" disabled className="gap-2 ml-4">
            <Clock className="h-3.5 w-3.5" />
            Request Sent
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="ml-4 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            onClick={handleRequestAccess}
            disabled={requestState === "loading"}
          >
            {requestState === "loading" ? "Requesting…" : "Request Developer Access"}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
