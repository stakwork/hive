"use client";

import { GitHubAuthModal } from "@/components/auth/GitHubAuthModal";
import { GraphMindsetCard } from "@/components/onboarding/GraphMindsetCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { extractRepoNameFromUrl, nextIndexedName } from "@/lib/utils/slug";
import { ArrowRight, AlertCircle, Code2, Cpu, Github, Hexagon, Loader2, X, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { signOut, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useRef, useEffect, useCallback } from "react";

interface WelcomeStepProps {
  onNext: (repositoryUrl?: string) => void;
}

const HIVE_FEATURES = [
  { icon: Zap, label: "AI-powered task management" },
  { icon: Code2, label: "Automated code quality janitors" },
  { icon: Cpu, label: "Pod orchestration & repair" },
  { icon: Github, label: "Deep GitHub App integration" },
];

export const WelcomeStep = ({}: WelcomeStepProps) => {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [error, setError] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [hiveAmountUsd, setHiveAmountUsd] = useState<number | null>(null);
  const [creationStatus, setCreationStatus] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingRepoUrl, setPendingRepoUrl] = useState("");

  // Payment return state
  const [showCancelBanner, setShowCancelBanner] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [isClaiming, setIsClaiming] = useState(false);

  const { data: session, status: sessionStatus } = useSession();
  const { refreshWorkspaces, workspaces } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCreatingRef = useRef(false);
  const claimCalledRef = useRef(false);

  const claimPayment = useCallback(
    async (stripeSessionId?: string) => {
      if (claimCalledRef.current) return;
      claimCalledRef.current = true;

      setIsClaiming(true);
      try {
        const res = await fetch("/api/stripe/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stripeSessionId ? { sessionId: stripeSessionId } : {}),
        });
        const data = await res.json();

        if (!res.ok) {
          setClaimError(data?.error || "Failed to link payment. Please contact support.");
          setIsClaiming(false);
          return;
        }

        if (data?.payment) {
          setIsClaiming(false);
          const wType = data.workspaceType;
          if (wType === "hive") {
            const repoUrl = data.repositoryUrl || localStorage.getItem("repoUrl") || "";
            if (repoUrl) {
              createWorkspaceAutomatically(repoUrl);
            } else {
              setClaimError("No repository URL found. Please enter your GitHub repository URL below.");
            }
          } else {
            router.push(data.redirect || "/onboarding/graphmindset");
          }
        } else {
          setClaimError("Failed to confirm payment. Please contact support.");
          setIsClaiming(false);
        }
      } catch {
        setClaimError("Something went wrong linking your payment. Please contact support.");
        setIsClaiming(false);
      }
    },
    [router]
  );

  useEffect(() => {
    fetch("/api/config/price?type=hive")
      .then((r) => r.json())
      .then((d) => { if (d?.amountUsd != null) setHiveAmountUsd(d.amountUsd); })
      .catch(() => {});
  }, []);

  // Handle Stripe cancel on mount
  useEffect(() => {
    if (searchParams.get("payment") === "cancelled") {
      setShowCancelBanner(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect to sign-in when session resolves as unauthenticated during payment return
  useEffect(() => {
    if (sessionStatus !== "unauthenticated") return;
    const paymentState = searchParams.get("payment");
    if (paymentState !== "success") return;
    const stripeSessionId = searchParams.get("session_id");
    const returnUrl = `/onboarding/workspace?payment=success${stripeSessionId ? `&session_id=${stripeSessionId}` : ""}&workspace_type=${searchParams.get("workspace_type") ?? ""}`;
    router.push(`/auth/signin?redirect=${encodeURIComponent(returnUrl)}`);
  }, [sessionStatus, searchParams, router]);

  // When session loads asynchronously after mount, try to claim
  useEffect(() => {
    if (!session?.user) return;
    const paymentState = searchParams.get("payment");
    if (paymentState === "success") {
      const stripeSessionId = searchParams.get("session_id");
      claimPayment(stripeSessionId || undefined);
    }
  // Only re-run when session becomes available
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

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
      if (!repoName) throw new Error("Could not extract repository name from URL");

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
      if (!response.ok) throw new Error(data.error || "Failed to create workspace");

      if (data?.workspace?.slug && data?.workspace?.id) {
        await refreshWorkspaces();
        fetch(`/api/workspaces/${data.workspace.slug}/access`, { method: "POST" }).catch(console.error);

        const statusResponse = await fetch(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(repoUrl)}`
        );
        const statusData = await statusResponse.json();

        if (statusData.hasPushAccess) {
          localStorage.removeItem("repoUrl");
          localStorage.removeItem("pendingHiveCreate");
          router.push(`/w/${data.workspace.slug}?github_setup_action=existing_installation`);
          return;
        }

        const installResponse = await fetch("/api/github/app/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceSlug: data.workspace.slug, repositoryUrl: repoUrl }),
        });
        const installData = await installResponse.json();

        if (installData.success && installData.data?.link) {
          localStorage.removeItem("repoUrl");
          localStorage.removeItem("pendingHiveCreate");
          window.location.href = installData.data.link;
        } else {
          throw new Error(installData.message || "Failed to generate GitHub App installation link");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
      setIsCreatingWorkspace(false);
      isCreatingRef.current = false;
    }
  };

  // Auto-resume workspace creation after OAuth sign-in redirect
  useEffect(() => {
    if (!session?.user) return;
    if (searchParams.get("payment")) return; // don't interfere with payment flow
    if (localStorage.getItem("pendingHiveCreate") !== "true") return;
    localStorage.removeItem("pendingHiveCreate");
    const repoUrl = localStorage.getItem("repoUrl");
    if (repoUrl && validateGitHubUrl(repoUrl)) {
      setRepositoryUrl(repoUrl);
      createWorkspaceAutomatically(repoUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

  const handleNext = () => {
    const trimmedUrl = repositoryUrl.trim().replace(/\/$/, "");
    if (!trimmedUrl) { setError("Please enter a GitHub repository URL"); return; }
    if (!validateGitHubUrl(trimmedUrl)) {
      setError("Please enter a valid GitHub repository URL (e.g., https://github.com/username/repo)");
      return;
    }
    localStorage.setItem("repoUrl", trimmedUrl);
    if (!session?.user) {
      localStorage.setItem("pendingHiveCreate", "true");
      setPendingRepoUrl(trimmedUrl);
      setShowAuthModal(true);
      return;
    }
    createWorkspaceAutomatically(trimmedUrl);
  };

  const handleAuthSuccess = () => {
    if (pendingRepoUrl) { createWorkspaceAutomatically(pendingRepoUrl); setPendingRepoUrl(""); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleNext();
  };

  // Show loading while session is resolving (prevents flash after sign-in redirect)
  const paymentState = searchParams.get("payment");
  const isPaymentReturn = paymentState === "success" && !claimError;

  if (sessionStatus === "loading" || isClaiming || isPaymentReturn) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-400" />
          <p className="text-sm text-zinc-400">
            {isClaiming
              ? "Linking your payment..."
              : isPaymentReturn
                ? "Completing payment..."
                : "Loading..."}
          </p>
        </div>
      </div>
    );
  }

  if (claimError) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center space-y-4">
          <p className="text-red-400 font-medium">{claimError}</p>
          <p className="text-sm text-zinc-400">
            Please{" "}
            <a href="mailto:support@stakwork.com" className="underline text-blue-400">
              contact support
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sign In link — visible only when no session */}
      {!session?.user && (
        <div className="flex justify-end">
          <button
            onClick={() => router.push("/auth/signin?redirect=/workspaces")}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Sign in to existing workspace
          </button>
        </div>
      )}

      {/* Cancel banner */}
      {showCancelBanner && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-yellow-400/50 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-300">
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

      {/* Two-column card grid */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Hive card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-8 flex flex-col gap-6"
        >
          {/* Icon */}
          <div className="relative w-12 h-12">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              {isCreatingWorkspace ? (
                <Loader2 className="w-6 h-6 animate-spin text-white" />
              ) : (
                <Hexagon className="w-6 h-6 text-white" />
              )}
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-white border-2 border-zinc-900" />
          </div>

          {/* Header */}
          <div>
            <h2 className="text-xl font-semibold text-white mb-1">Hive</h2>
            <p className="text-zinc-400 text-sm leading-relaxed">
              {isCreatingWorkspace
                ? "Setting up your workspace..."
                : "AI-first PM toolkit that automates janitor workflows, lifts test coverage, and hardens your codebase — all from a single GitHub repo."}
            </p>
          </div>

          {/* Features */}
          <ul className="space-y-2">
            {HIVE_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-zinc-300">
                <Icon className="w-4 h-4 text-blue-400 shrink-0" />
                {label}
              </li>
            ))}
          </ul>

          {/* Price */}
          <p className="text-zinc-500 text-sm font-medium">
            <span className="text-white text-lg font-bold">
              {hiveAmountUsd !== null ? `$${hiveAmountUsd}` : "—"}
            </span>{" "}
            / environment
          </p>

          {/* Input + CTA */}
          {!isCreatingWorkspace ? (
            <>
              <div className="space-y-1">
                <Input
                  id="repository-url"
                  type="url"
                  placeholder="https://github.com/username/repository"
                  value={repositoryUrl}
                  onChange={(e) => handleRepositoryUrlChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isCreatingWorkspace}
                  className={`bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-blue-500 ${error ? "border-red-500 focus:border-red-500" : ""}`}
                />
                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Button
                  onClick={handleNext}
                  disabled={!repositoryUrl.trim() || isCreatingWorkspace}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Create Hive
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
              <div className="text-sm text-zinc-400 text-center">{creationStatus}</div>
            </div>
          )}
        </motion.div>

        {/* GraphMindset card */}
        <GraphMindsetCard />
      </div>

      {/* Authenticated user footer links */}
      {session?.user && workspaces.length > 0 && (
        <div className="text-center">
          <Button
            variant="outline"
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            onClick={() => router.push("/")}
          >
            Go to my workspace
          </Button>
        </div>
      )}
      {session?.user && (
        <div className="text-center">
          <button
            onClick={() => signOut({ callbackUrl: "/auth/signin", redirect: true })}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Switch account
          </button>
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
