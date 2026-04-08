"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertCircle, Smartphone } from "lucide-react";
import { motion } from "framer-motion";

const POLL_INTERVAL = 2000;
const CHALLENGE_EXPIRATION = 5 * 60 * 1000; // 5 minutes

type Step = "sphinx-link" | "fork-repo" | "provision";

const stepMotion = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

const darkCard = "rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-8 flex flex-col gap-6";
const loadingContainer = "min-h-[320px] flex flex-col items-center justify-center gap-4";

export function GraphMindsetOnboardingClient() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>("sphinx-link");
  const [forkUrl, setForkUrl] = useState<string | null>(null);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(`/auth/signin?redirect=${encodeURIComponent("/onboarding/graphmindset")}`);
    }
  }, [status, router]);

  // Skip Sphinx link if already connected
  const isSphinxLinked = !!(session?.user as { lightningPubkey?: string } | undefined)?.lightningPubkey;

  // Auto-advance past sphinx step if already linked
  useEffect(() => {
    if (isSphinxLinked && currentStep === "sphinx-link") {
      setCurrentStep("fork-repo");
    }
  }, [isSphinxLinked, currentStep]);

  if (status === "loading") {
    return (
      <div className={loadingContainer}>
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!session?.user) return null;

  return (
    <div>
      {currentStep === "sphinx-link" && (
        <SphinxLinkStep
          isAlreadyLinked={isSphinxLinked}
          onComplete={() => setCurrentStep("fork-repo")}
          onSessionUpdate={update}
        />
      )}
      {currentStep === "fork-repo" && (
        <ForkRepoStep
          onComplete={(url) => {
            setForkUrl(url);
            setCurrentStep("provision");
          }}
        />
      )}
      {currentStep === "provision" && forkUrl && (
        <ProvisionStep forkUrl={forkUrl} />
      )}
    </div>
  );
}

// =============================================================================
// Sphinx Link Step
// =============================================================================

interface SphinxLinkStepProps {
  isAlreadyLinked: boolean;
  onComplete: () => void;
  onSessionUpdate: () => Promise<unknown>;
}

function SphinxLinkStep({ isAlreadyLinked, onComplete, onSessionUpdate }: SphinxLinkStepProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(isAlreadyLinked);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  const cleanup = useCallback(() => {
    setIsLoading(false);
    setQrCode(null);
    setDeepLink(null);
    setChallenge(null);
    setIsVerified(false);
    setIsLinking(false);
    setError(null);
    setIsExpired(false);
  }, []);

  const fetchChallenge = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/sphinx/challenge", { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate challenge");

      const data = await res.json();
      setChallenge(data.challenge);
      setQrCode(data.qrCode);
      setDeepLink(data.deepLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate challenge");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Poll for verification
  useEffect(() => {
    if (!challenge || !qrCode || isVerified || isExpired || error) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/sphinx/poll/${challenge}`);
        if (!res.ok) return;

        const data = await res.json();
        if (data.verified && data.pubkey) {
          setIsVerified(true);
          clearInterval(pollInterval);
        }
      } catch {
        // Silently retry
      }
    }, POLL_INTERVAL);

    const expirationTimeout = setTimeout(() => {
      setIsExpired(true);
      setError("Challenge expired. Please try again.");
      clearInterval(pollInterval);
    }, CHALLENGE_EXPIRATION);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(expirationTimeout);
    };
  }, [challenge, qrCode, isVerified, isExpired, error]);

  // Link account when verified
  useEffect(() => {
    if (!isVerified || !challenge || isLinking || isSuccess) return;

    const linkAccount = async () => {
      setIsLinking(true);
      try {
        const res = await fetch("/api/auth/sphinx/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challenge }),
        });

        if (!res.ok) throw new Error("Failed to link account");

        setIsSuccess(true);
        await onSessionUpdate();
        onComplete();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link account");
        setIsVerified(false);
      } finally {
        setIsLinking(false);
      }
    };

    linkAccount();
  }, [isVerified, challenge, isLinking, isSuccess, onComplete, onSessionUpdate]);

  // Auto-fetch challenge on mount if not already linked
  useEffect(() => {
    if (!isAlreadyLinked && !challenge && !isLoading) {
      fetchChallenge();
    }
  }, [isAlreadyLinked, challenge, isLoading, fetchChallenge]);

  const handleRetry = () => {
    cleanup();
    fetchChallenge();
  };

  if (isSuccess) {
    return (
      <motion.div {...stepMotion}>
        <div className={darkCard}>
          <div className={loadingContainer}>
            <Check className="h-12 w-12 text-green-500" />
            <p className="font-medium text-lg text-zinc-100">Sphinx account linked</p>
            <p className="text-sm text-zinc-400">
              You can now perform GitHub actions from the Sphinx mobile app.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (isLoading || isLinking) {
    return (
      <motion.div {...stepMotion}>
        <div className={darkCard}>
          <div className={loadingContainer}>
            <Loader2 className="h-12 w-12 animate-spin text-zinc-400" />
            <p className="text-sm text-zinc-400">
              {isLinking ? "Linking your account..." : "Generating QR code..."}
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div {...stepMotion}>
        <div className={darkCard}>
          <div className={loadingContainer}>
            <AlertCircle className="h-12 w-12 text-red-400" />
            <p className="text-sm text-center text-red-400">{error}</p>
            <Button onClick={handleRetry} variant="outline" className="border-zinc-700 text-zinc-100 hover:bg-zinc-800">
              Try Again
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div {...stepMotion}>
      <div className={darkCard}>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mb-2">
            <Smartphone className="w-8 h-8 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-100">Link your Sphinx account</h2>
          <p className="text-zinc-400 text-base">
            Scan this QR code with your Sphinx app to link your account
          </p>
        </div>

        <div className={loadingContainer}>
          {qrCode && !isVerified && !isExpired && !error ? (
            <div className="flex flex-col items-center gap-4">
              <Image
                src={qrCode}
                alt="Sphinx QR Code"
                width={300}
                height={300}
                className="border border-zinc-700 rounded-lg"
                unoptimized
              />
              {deepLink && (
                <a
                  href={deepLink}
                  className="text-sm text-blue-400 hover:underline"
                >
                  Open in Sphinx app
                </a>
              )}
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                <p className="text-sm text-zinc-400">Waiting for Sphinx app...</p>
              </div>
            </div>
          ) : (
            <Loader2 className="h-12 w-12 animate-spin text-zinc-500" />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// Fork Repo Step
// =============================================================================

interface ForkRepoStepProps {
  onComplete: (forkUrl: string) => void;
}

function ForkRepoStep({ onComplete }: ForkRepoStepProps) {
  const router = useRouter();
  const [isForking, setIsForking] = useState(false);
  const [forkUrl, setForkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const forkCalledRef = useRef(false);

  const doFork = useCallback(async () => {
    setIsForking(true);
    setError(null);
    setNeedsReauth(false);

    try {
      const configRes = await fetch("/api/github/fork/config");
      const configData = await configRes.json();
      const repoUrl = configData.repoUrl;

      if (!repoUrl) {
        setError("No repository configured for forking. Please contact support.");
        return;
      }

      const res = await fetch("/api/github/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: repoUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "github_token_expired" || data.error === "insufficient_scope") {
          setNeedsReauth(true);
          setError("Your GitHub session has expired. Please re-authenticate to continue.");
        } else {
          setError(data.error || "Failed to fork repository");
        }
        return;
      }

      setForkUrl(data.forkUrl);
      onComplete(data.forkUrl);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsForking(false);
    }
  }, [onComplete]);

  // Auto-fork on mount
  useEffect(() => {
    if (forkCalledRef.current) return;
    forkCalledRef.current = true;
    doFork();
  }, [doFork]);

  const handleRetry = () => {
    forkCalledRef.current = true;
    doFork();
  };

  if (forkUrl) {
    return (
      <motion.div {...stepMotion}>
        <div className={darkCard}>
          <div className={loadingContainer}>
            <Check className="h-12 w-12 text-green-500" />
            <p className="font-medium text-lg text-zinc-100">Repository ready</p>
            <a
              href={forkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:underline"
            >
              {forkUrl}
            </a>
          </div>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div {...stepMotion}>
        <div className={darkCard}>
          <div className={loadingContainer}>
            <AlertCircle className="h-12 w-12 text-red-400" />
            <p className="text-sm text-center text-red-400">{error}</p>
            {needsReauth ? (
              <Button
                onClick={() =>
                  router.push(
                    `/auth/signin?redirect=${encodeURIComponent("/onboarding/graphmindset")}`,
                  )
                }
                className="bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700"
              >
                Re-authenticate with GitHub
              </Button>
            ) : (
              <Button onClick={handleRetry} variant="outline" className="border-zinc-700 text-zinc-100 hover:bg-zinc-800">
                Try Again
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div {...stepMotion}>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-400" />
        <p className="text-sm text-zinc-400">
          {isForking ? "Creating your fork..." : "Setting up your repository..."}
        </p>
      </div>
    </motion.div>
  );
}

// =============================================================================
// Provision Step
// =============================================================================

interface ProvisionStepProps {
  forkUrl: string;
}

function ProvisionStep({ forkUrl }: ProvisionStepProps) {
  const router = useRouter();
  const provisionCalledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const provision = useCallback(async () => {
    setError(null);

    try {
      const paymentRes = await fetch("/api/graphmindset/payment");
      const paymentData = await paymentRes.json();
      if (paymentData.alreadyProvisioned && paymentData.workspaceSlug) {
        router.replace(`/w/${paymentData.workspaceSlug}`);
        return;
      }
      if (!paymentRes.ok) {
        router.push("/workspaces");
        return;
      }
      const { workspaceName, workspaceSlug } = paymentData.payment;

      if (!workspaceName || !workspaceSlug) {
        setError("Missing workspace details. Please contact support.");
        return;
      }

      const wsRes = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workspaceName,
          slug: workspaceSlug,
          workspaceKind: "graph_mindset",
          repositoryUrl: forkUrl,
        }),
      });
      const wsData = await wsRes.json();
      if (!wsRes.ok) {
        setError(wsData.error || "Failed to create workspace");
        return;
      }
      const { slug } = wsData.workspace;

      router.push(`/w/${slug}`);
    } catch {
      setError("Something went wrong. Please try again.");
    }
  }, [forkUrl, router]);

  useEffect(() => {
    if (provisionCalledRef.current) return;
    provisionCalledRef.current = true;
    provision().catch(() => setError("Something went wrong. Please try again."));
  }, [provision]);

  const handleRetry = () => {
    provisionCalledRef.current = true;
    setError(null);
    provision().catch(() => setError("Something went wrong. Please try again."));
  };

  if (error) {
    return (
      <motion.div {...stepMotion}>
        <div className={darkCard}>
          <div className={loadingContainer}>
            <AlertCircle className="h-12 w-12 text-red-400" />
            <p className="text-sm text-center text-red-400">{error}</p>
            <Button onClick={handleRetry} variant="outline" className="border-zinc-700 text-zinc-100 hover:bg-zinc-800">
              Try Again
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div {...stepMotion}>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-400" />
        <p className="text-sm text-zinc-400">Setting up your workspace...</p>
      </div>
    </motion.div>
  );
}
