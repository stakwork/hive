import { GitHubAuthModal } from "@/components/auth/GitHubAuthModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SupportedLanguages } from "@/lib/constants";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useState, useRef } from "react";

interface WelcomeStepProps {
  onNext: (repositoryUrl?: string) => void;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nextIndexedName(base: string, pool: string[]) {
  const re = new RegExp(`^${escapeRegex(base)}(?:-(\\d+))?$`, "i");
  let max = -1;
  for (const name of pool) {
    const m = name.match(re);
    if (!m) continue;
    const idx = m[1] ? Number(m[1]) : 0; // plain "base" => 0
    if (idx > max) max = idx;
  }
  const next = max + 1;
  return next === 0 ? base : `${base}-${next}`;
}

function extractRepoNameFromUrl(url: string): string | null {
  try {
    // Handle various GitHub URL formats
    const githubMatch = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (githubMatch) {
      return githubMatch[2]; // Return the repository name
    }
    return null;
  } catch (error) {
    console.error("Error extracting repo name from URL:", error);
    return null;
  }
}

export const WelcomeStep = ({ onNext }: WelcomeStepProps) => {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [error, setError] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [creationStatus, setCreationStatus] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingRepoUrl, setPendingRepoUrl] = useState("");
  const { data: session } = useSession();
  const { refreshWorkspaces, workspaces } = useWorkspace();
  const router = useRouter();
  const isCreatingRef = useRef(false);

  const validateGitHubUrl = (url: string): boolean => {
    // Basic GitHub URL validation
    const githubUrlPattern = /^https:\/\/github\.com\/[^\/]+\/[^\/]+(\/.*)?$/;
    return githubUrlPattern.test(url.trim());
  };

  const handleRepositoryUrlChange = (value: string) => {
    setRepositoryUrl(value);
    localStorage.setItem("repoUrl", value);
    setError(""); // Clear error when user types
  };

  const createWorkspaceAutomatically = async (repoUrl: string) => {
    if (isCreatingRef.current) return;

    setIsCreatingWorkspace(true);
    setCreationStatus("Creating your workspace...");
    isCreatingRef.current = true;

    try {
      // Extract repo name and find available workspace name
      const repoName = extractRepoNameFromUrl(repoUrl);
      if (!repoName) {
        throw new Error("Could not extract repository name from URL");
      }

      const base = repoName.toLowerCase();
      const pool = workspaces.map(w => w.slug.toLowerCase());
      let projectName = nextIndexedName(base, pool);

      // Verify name is available via API
      const slugResponse = await fetch(`/api/workspaces/slug-availability?slug=${encodeURIComponent(projectName)}`);
      const slugData = await slugResponse.json();

      if (!slugData.success || !slugData.data.isAvailable) {
        // If still not available, add a timestamp suffix
        projectName = `${base}-${Date.now().toString().slice(-6)}`;
      }

      // Create workspace
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          description: '',
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

        // Check GitHub App status for this workspace/repository
        const statusResponse = await fetch(`/api/github/app/check?repositoryUrl=${encodeURIComponent(repoUrl)}`);
        const statusData = await statusResponse.json();

        if (statusData.hasPushAccess) {
          // GitHub App is already installed and has tokens, redirect to dashboard
          router.push(`/w/${data.workspace.slug}?github_setup_action=existing_installation`);
          return;
        } else {
          // GitHub App not installed or no tokens, proceed with installation
          const installResponse = await fetch("/api/github/app/install", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              workspaceSlug: data.workspace.slug,
              repositoryUrl: repoUrl
            }),
          });

          const installData = await installResponse.json();

          if (installData.success && installData.data?.link) {
            // Navigate to GitHub App installation
            window.location.href = installData.data.link;
            return;
          } else {
            throw new Error(installData.message || "Failed to generate GitHub App installation link");
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
      setError("Please enter a valid GitHub repository URL (e.g., https://github.com/username/repo)");
      return;
    }

    // Store in localStorage for backward compatibility
    localStorage.setItem("repoUrl", trimmedUrl);

    // Check if user is authenticated
    if (!session?.user) {
      // Not authenticated - show auth modal
      setPendingRepoUrl(trimmedUrl);
      setShowAuthModal(true);
      return;
    }

    // Already authenticated - create workspace immediately
    createWorkspaceAutomatically(trimmedUrl);
  };

  const handleAuthSuccess = () => {
    // Auth completed, now create workspace with the pending URL
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
    await signOut({
      callbackUrl: "/auth/signin",
      redirect: true,
    });
  };

  return (
    <div className="max-w-2xl mx-auto">
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
            {isCreatingWorkspace ? "Please wait while we set things up" : "Paste your GitHub repository to get started"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
        {!isCreatingWorkspace ? (
          <>
            {/* Repository URL Input */}
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
              <Button onClick={handleNext} className="px-8 py-3" disabled={!repositoryUrl.trim() || isCreatingWorkspace}>
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

        {/* Language Support - subtle at bottom */}
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

    {/* Account options below the card */}
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

    {/* GitHub Auth Modal */}
    <GitHubAuthModal
      isOpen={showAuthModal}
      onClose={() => setShowAuthModal(false)}
      onAuthSuccess={handleAuthSuccess}
    />
    </div>
  );
};
