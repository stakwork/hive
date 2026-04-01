"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertCircle, Smartphone, GitFork, Network } from "lucide-react";

const POLL_INTERVAL = 2000;
const CHALLENGE_EXPIRATION = 5 * 60 * 1000; // 5 minutes

type Step = "sphinx-link" | "fork-repo" | "create-graph" | "create-workspace";

interface GraphResult {
  swarmId?: string;
  url?: string;
}

export function GraphMindsetOnboardingClient() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>("sphinx-link");
  const [forkUrl, setForkUrl] = useState<string | null>(null);
  const [graphResult, setGraphResult] = useState<GraphResult | null>(null);

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
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session?.user) return null;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
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
            setCurrentStep("create-graph");
          }}
        />
      )}
      {currentStep === "create-graph" && (
        <CreateGraphStep
          onComplete={(result) => {
            setGraphResult(result);
            setCurrentStep("create-workspace");
          }}
        />
      )}
      {currentStep === "create-workspace" && (
        <CreateWorkspaceStep
          forkUrl={forkUrl}
          graphResult={graphResult}
        />
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
        onComplete(data.forkUrl);
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
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-4">
          <Check className="h-12 w-12 text-green-500" />
          <p className="font-medium text-lg">Sphinx account linked</p>
          <p className="text-sm text-muted-foreground">
            You can now perform GitHub actions from the Sphinx mobile app.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <Smartphone className="w-8 h-8 text-purple-600 dark:text-purple-400" />
        </div>
        <CardTitle className="text-2xl">Link your Sphinx account</CardTitle>
        <CardDescription className="text-lg">
          Scan this QR code with your Sphinx app to link your account
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {isLoading && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generating QR code...</p>
          </div>
        )}

        {qrCode && !isVerified && !isExpired && !error && (
          <div className="flex flex-col items-center gap-4">
            <Image
              src={qrCode}
              alt="Sphinx QR Code"
              width={300}
              height={300}
              className="border rounded-lg"
              unoptimized
            />
            {deepLink && (
              <a
                href={deepLink}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Open in Sphinx app
              </a>
            )}
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm text-muted-foreground">Waiting for Sphinx app...</p>
            </div>
          </div>
        )}

        {isLinking && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Linking your account...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-4 py-8">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-sm text-center text-destructive">{error}</p>
            <Button onClick={handleRetry} variant="outline">
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Fork Repo Step
// =============================================================================

interface ForkRepoStepProps {
  onComplete: (forkUrl: string) => void;
}

function ForkRepoStep({ onComplete }: ForkRepoStepProps) {
  const [isForking, setIsForking] = useState(false);
  const [forkUrl, setForkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const forkCalledRef = useRef(false);

  // Auto-fork on mount: fetch config then fork
  useEffect(() => {
    if (forkCalledRef.current) return;
    forkCalledRef.current = true;

    const forkRepo = async () => {
      setIsForking(true);
      setError(null);

      try {
        // Get configured repo URL
        const configRes = await fetch("/api/github/fork/config");
        const configData = await configRes.json();
        const repoUrl = configData.repoUrl;

        if (!repoUrl) {
          setError("No repository configured for forking. Please contact support.");
          setIsForking(false);
          return;
        }

        // Fork it (or reuse existing fork)
        const res = await fetch("/api/github/fork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryUrl: repoUrl }),
        });
        const data = await res.json();

        if (!res.ok) {
          if (data.error === "insufficient_scope") {
            setError("Your GitHub token doesn't have permission to fork repositories. Please re-authenticate.");
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
    };

    forkRepo();
  }, [onComplete]);

  const handleRetry = () => {
    forkCalledRef.current = false;
    setError(null);
    setForkUrl(null);
    // Re-trigger by resetting the ref and forcing re-render
    forkCalledRef.current = true;

    const retry = async () => {
      setIsForking(true);
      setError(null);
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
          setError(data.error || "Failed to fork repository");
          return;
        }
        setForkUrl(data.forkUrl);
        onComplete(data.forkUrl);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setIsForking(false);
      }
    };
    retry();
  };

  if (forkUrl) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-4">
          <Check className="h-12 w-12 text-green-500" />
          <p className="font-medium text-lg">Repository ready</p>
          <a
            href={forkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {forkUrl}
          </a>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-sm text-center text-destructive">{error}</p>
          <Button onClick={handleRetry} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <GitFork className="w-8 h-8 text-blue-600 dark:text-blue-400" />
        </div>
        <CardTitle className="text-2xl">Setting up your repository</CardTitle>
        <CardDescription>
          {isForking ? "Creating your fork..." : "Preparing..."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center py-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Create Graph Step
// =============================================================================

interface CreateGraphStepProps {
  onComplete: (result: GraphResult) => void;
}

function CreateGraphStep({ onComplete }: CreateGraphStepProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [graphUrl, setGraphUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createCalledRef = useRef(false);

  const createGraph = useCallback(async () => {
    setIsCreating(true);
    setError(null);

    try {
      // Fetch graph name from payment record
      const paymentRes = await fetch("/api/graphmindset/payment");
      const paymentData = await paymentRes.json();

      if (!paymentRes.ok) {
        setError(paymentData.error || "No payment found. Please complete payment first.");
        return;
      }

      const name = paymentData.payment?.workspaceName || paymentData.payment?.workspaceSlug;
      if (!name) {
        setError("Missing workspace name. Please contact support.");
        return;
      }

      const res = await fetch("/api/graphmindset/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create graph");
        return;
      }

      setGraphUrl(data.graph?.url || null);
      onComplete({
        swarmId: data.graph?.swarmId,
        url: data.graph?.url,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }, [onComplete]);

  // Auto-create on mount
  useEffect(() => {
    if (createCalledRef.current) return;
    createCalledRef.current = true;
    createGraph();
  }, [createGraph]);

  const handleRetry = () => {
    createCalledRef.current = true;
    setError(null);
    setGraphUrl(null);
    createGraph();
  };

  if (graphUrl) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-4">
          <Check className="h-12 w-12 text-green-500" />
          <p className="font-medium text-lg">Your graph is ready!</p>
          <a
            href={graphUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {graphUrl}
          </a>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-sm text-center text-destructive">{error}</p>
          <Button onClick={handleRetry} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <Network className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <CardTitle className="text-2xl">Creating your graph</CardTitle>
        <CardDescription>
          {isCreating ? "Provisioning your knowledge graph..." : "Preparing..."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center py-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Create Workspace Step
// =============================================================================

interface CreateWorkspaceStepProps {
  forkUrl: string | null;
  graphResult: GraphResult | null;
}

function CreateWorkspaceStep({ forkUrl, graphResult }: CreateWorkspaceStepProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createCalledRef = useRef(false);

  const createWorkspace = useCallback(async () => {
    setIsCreating(true);
    setError(null);

    try {
      // Fetch workspace name from payment record
      const paymentRes = await fetch("/api/graphmindset/payment");
      const paymentData = await paymentRes.json();

      if (!paymentRes.ok) {
        setError(paymentData.error || "No payment found.");
        return;
      }

      const name = paymentData.payment?.workspaceName;
      const slug = paymentData.payment?.workspaceSlug;

      if (!name || !slug) {
        setError("Missing workspace details. Please contact support.");
        return;
      }

      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          repositoryUrl: forkUrl,
          workspaceKind: "graph_mindset",
          swarmId: graphResult?.swarmId,
          graphUrl: graphResult?.url,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create workspace");
        return;
      }

      // Navigate to the new workspace
      if (data.workspace?.slug) {
        router.push(`/w/${data.workspace.slug}`);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }, [forkUrl, graphResult, router]);

  // Auto-create on mount
  useEffect(() => {
    if (createCalledRef.current) return;
    createCalledRef.current = true;
    createWorkspace();
  }, [createWorkspace]);

  const handleRetry = () => {
    createCalledRef.current = true;
    setError(null);
    createWorkspace();
  };

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-sm text-center text-destructive">{error}</p>
          <Button onClick={handleRetry} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
        </div>
        <CardTitle className="text-2xl">Setting up your workspace</CardTitle>
        <CardDescription>
          {isCreating ? "Creating your workspace..." : "Preparing..."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center py-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
