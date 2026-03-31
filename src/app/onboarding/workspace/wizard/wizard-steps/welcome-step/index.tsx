"use client";

import { GitHubAuthModal } from "@/components/auth/GitHubAuthModal";
import { GraphMindsetCard } from "@/components/onboarding/GraphMindsetCard";
import { SwarmSetupLoader } from "@/components/onboarding/SwarmSetupLoader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SupportedLanguages } from "@/lib/constants";
import { extractRepoNameFromUrl, nextIndexedName } from "@/lib/utils/slug";
import { AlertCircle, ArrowRight, Loader2, X } from "lucide-react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { redirect, useRouter, useSearchParams } from "next/navigation";
import React, { useState, useRef, useEffect, useCallback } from "react";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface WelcomeStepProps {
  onNext: (repositoryUrl?: string) => void;
}

export const WelcomeStep = ({}: WelcomeStepProps) => {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [error, setError] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [creationStatus, setCreationStatus] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingRepoUrl, setPendingRepoUrl] = useState("");

  // Payment return state
  const [cancelledWorkspaceId, setCancelledWorkspaceId] = useState<string | null>(null);
  const [showCancelBanner, setShowCancelBanner] = useState(false);
  const [isPollingSwarm, setIsPollingSwarm] = useState(false);
  const [pollError, setPollError] = useState("");

  const { data: session } = useSession();
  const { refreshWorkspaces, workspaces } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCreatingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const startSwarmPolling = useCallback(
    (workspaceId: string) => {
      const poll = async () => {
        try {
          const res = await fetch("/api/swarm/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          });
          const data = await res.json();

          if (data?.status === "ACTIVE") {
            stopPolling();
            localStorage.removeItem("graphMindsetWorkspaceId");

            // Fetch workspace slug
            const wsRes = await fetch("/api/workspaces");
            const wsData = await wsRes.json();
            const ws = wsData?.workspaces?.find(
              (w: { id: string; slug: string }) => w.id === workspaceId
            );
            router.push(ws?.slug ? `/w/${ws.slug}` : "/");
          }
        } catch {
          // Silently retry on transient errors
        }
      };

      poll(); // immediate first attempt
      pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);

      pollTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setIsPollingSwarm(false);
        setPollError(
          "Swarm provisioning is taking longer than expected. Please contact support."
        );
      }, POLL_TIMEOUT_MS);
    },
    [router, stopPolling]
  );

  // Handle Stripe return on mount
  useEffect(() => {
    const paymentState = searchParams.get("payment");
    if (!paymentState) return;

    const storedWorkspaceId =
      typeof window !== "undefined"
        ? localStorage.getItem("graphMindsetWorkspaceId")
        : null;

    if (paymentState === "success" && storedWorkspaceId) {
      setIsPollingSwarm(true);
      startSwarmPolling(storedWorkspaceId);
    } else if (paymentState === "cancelled" && storedWorkspaceId) {
      setCancelledWorkspaceId(storedWorkspaceId);
      setShowCancelBanner(true);
    }

    return () => stopPolling();
  }, [searchParams, startSwarmPolling, stopPolling]);

  const validateGitHubUrl = (url: string): boolean => {
    const githubUrlPattern = /^https:\/\/github\.com\/[^\/]+\/[^\/]+(\/.*)?$/;
    return githubUrlPattern.test(url.trim());
  };

  const handleRepositoryUrlChange = (value: string) => {
    setRepositoryUrl(value);
    localStorage.setItem("repoUrl", value);
    setError("");
  };

  const createWorkspaceAutomatically = async (repoUrl: string) => {
    if (isCreatingRef.current) return;

    setIsCreatingWorkspace(true);
    setCreationStatus("Creating your workspace...");
    isCreatingRef.current = true;

    try {
      const repoName = extractRepoNameFromUrl(repoUrl);
      if (!repoName) {
        throw new Error("Could not extract repository name from URL");
      }

      const base = repoName.toLowerCase();
      const pool = workspaces.map(w => w.slug.toLowerCase());
      let projectName = nextIndexedName(base, pool);

      const slugResponse = await fetch(
        `/api/workspaces/slug-availability?slug=${encodeURIComponent(projectName)}`
      );
      const slugData = await slugResponse.json();

      if (!slugData.success || !slugData.data.isAvailable) {
        projectName = `${base}-${Date.now().toString().slice(-6)}`;
      }

      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          description: "",
          slug: projectName,
          repositoryUrl: repoUrl,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create workspace");
      }

      if (data?.workspace?.slug && data?.workspace?.id) {
        await refreshWorkspaces();

        fetch(`/api/workspaces/${data.workspace.slug}/access`, {
          method: "POST",
        }).catch(console.error);

        const statusResponse = await fetch(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(repoUrl)}`
        );
        const statusData = await statusResponse.json();

        if (statusData.hasPushAccess) {
          router.push(
            `/w/${data.workspace.slug}?github_setup_action=existing_installation`
          );
          return;
        } else {
          const installResponse = await fetch("/api/github/app/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceSlug: data.workspace.slug,
              repositoryUrl: repoUrl,
            }),
          });

          const installData = await installResponse.json();

          if (installData.success && installData.data?.link) {
            window.location.href = installData.data.link;
            return;
          } else {
            throw new Error(
              installData.message || "Failed to generate GitHub App installation link"
            );
          }
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create workspace");
      setIsCreatingWorkspace(false);
      isCreatingRef.current = false;
    }
  };

  const handleNext = () => {
    const trimmedUrl = repositoryUrl.trim().replace(/\/$/, "");

    if (!trimmedUrl) {
      setError("Please enter a GitHub repository URL");
      return;
    }

    if (!validateGitHubUrl(trimmedUrl)) {
      setError(
        "Please enter a valid GitHub repository URL (e.g., https://github.com/username/repo)"
      );
      return;
    }

    localStorage.setItem("repoUrl", trimmedUrl);

    if (!session?.user) {
      setPendingRepoUrl(trimmedUrl);
      setShowAuthModal(true);
      return;
    }

    createWorkspaceAutomatically(trimmedUrl);
  };

  const handleAuthSuccess = () => {
    if (pendingRepoUrl) {
      createWorkspaceAutomatically(pendingRepoUrl);
      setPendingRepoUrl("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleNext();
    }
  };

  const redirectToLogin = () => {
    redirect("/auth/signin");
  };

  const createAccountOnly = () => {
    router.push("/auth/signin?redirect=/workspaces");
  };

  const logoutAndRedirectToLogin = async () => {
    await signOut({ callbackUrl: "/auth/signin", redirect: true });
  };

  // Success flow: show swarm provisioning loader
  if (isPollingSwarm) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        {pollError ? (
          <Card className="p-8 text-center space-y-4">
            <p className="text-destructive font-medium">{pollError}</p>
            <p className="text-sm text-muted-foreground">
              If this persists, please{" "}
              <a
                href="mailto:support@stakwork.com"
                className="underline text-primary"
              >
                contact support
              </a>
              .
            </p>
          </Card>
        ) : (
          <SwarmSetupLoader />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Card className="bg-card text-card-foreground">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
            {isCreatingWorkspace ? (
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
            ) : (
              <Image src="/apple-touch-icon.png" alt="Hive" width={40} height={40} />
            )}
          </div>
          <CardTitle className="text-2xl">
            {isCreatingWorkspace ? "Setting up your workspace..." : "Welcome to Hive"}
          </CardTitle>
          <CardDescription className="text-lg">
            {isCreatingWorkspace
              ? "Please wait while we set things up"
              : "Paste your GitHub repository to get started"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isCreatingWorkspace ? (
            <>
              <div className="max-w-md mx-auto">
                <Input
                  id="repository-url"
                  type="url"
                  placeholder="https://github.com/username/repository"
                  value={repositoryUrl}
                  onChange={(e) => handleRepositoryUrlChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className={`pr-10 ${error ? "border-red-500 focus:border-red-500" : ""}`}
                  disabled={isCreatingWorkspace}
                />
                {error && (
                  <div className="flex items-center gap-2 mt-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center gap-3">
                <Button
                  onClick={handleNext}
                  className="px-8 py-3"
                  disabled={!repositoryUrl.trim() || isCreatingWorkspace}
                >
                  Get Started
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <div className="text-sm text-muted-foreground text-center">
                {creationStatus}
              </div>
            </div>
          )}

          <Separator className="w-24 mx-auto" />

          <TooltipProvider delayDuration={0}>
            <div className="flex justify-center items-center gap-3">
              {SupportedLanguages.map((language, index) => {
                const IconComponent = language.icon;
                return (
                  <Tooltip key={index}>
                    <TooltipTrigger asChild>
                      <div className="opacity-40 hover:opacity-70 transition-opacity">
                        <IconComponent className={`w-4 h-4 ${language.color}`} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{language.name}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>

      {/* Cancelled payment banner */}
      {showCancelBanner && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <span>Payment cancelled — you can try again below.</span>
          <button
            onClick={() => setShowCancelBanner(false)}
            className="flex-shrink-0 hover:opacity-70 transition-opacity"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <GraphMindsetCard existingWorkspaceId={cancelledWorkspaceId ?? undefined} />

      {/* Account options */}
      {!session?.user ? (
        <div className="flex items-center justify-center gap-4 mt-6 text-sm text-muted-foreground">
          <button
            onClick={redirectToLogin}
            className="hover:text-primary transition-colors"
          >
            Sign in
          </button>
          <span>·</span>
          <button
            onClick={createAccountOnly}
            className="hover:text-primary transition-colors"
          >
            Create account
          </button>
        </div>
      ) : (
        <div className="text-center mt-6">
          <button
            onClick={logoutAndRedirectToLogin}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            Switch account
          </button>
        </div>
      )}

      {session?.user && workspaces.length > 0 && (
        <div className="text-center mt-4">
          <Button variant="outline" onClick={() => router.push("/")}>
            Go to my workspace
          </Button>
        </div>
      )}

      <GitHubAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
};
