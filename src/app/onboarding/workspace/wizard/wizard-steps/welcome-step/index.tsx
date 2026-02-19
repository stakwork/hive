import { GitHubAuthModal } from "@/components/auth/GitHubAuthModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SupportedLanguages } from "@/lib/constants";
import { extractRepoNameFromUrl, nextIndexedName } from "@/lib/utils/slug";
import { AlertCircle, ArrowRight, Loader2, Plus, X } from "lucide-react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useState, useRef } from "react";

interface WelcomeStepProps {
  onNext: (repositoryUrl?: string) => void;
}

const MAX_REPOSITORIES = 10;

export const WelcomeStep = ({}: WelcomeStepProps) => {
  const [repositoryUrls, setRepositoryUrls] = useState<string[]>([""]);
  const [errors, setErrors] = useState<string[]>([""]);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [creationStatus, setCreationStatus] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingRepoUrl, setPendingRepoUrl] = useState("");
  const { data: session } = useSession();
  const { refreshWorkspaces, workspaces } = useWorkspace();
  const router = useRouter();
  const isCreatingRef = useRef(false);

  const validateGitHubUrl = (url: string): boolean => {
    if (!url.trim()) return false;
    // Basic GitHub URL validation
    const githubUrlPattern = /^https:\/\/github\.com\/[^\/]+\/[^\/]+(\/.*)?$/;
    return githubUrlPattern.test(url.trim());
  };

  const handleRepositoryUrlChange = (index: number, value: string) => {
    const newUrls = [...repositoryUrls];
    newUrls[index] = value;
    setRepositoryUrls(newUrls);
    
    // Clear error for this specific repository
    const newErrors = [...errors];
    newErrors[index] = "";
    setErrors(newErrors);
    
    // Store first URL in localStorage for backward compatibility
    if (index === 0) {
      localStorage.setItem("repoUrl", value);
    }
  };

  const handleAddRepository = () => {
    if (repositoryUrls.length >= MAX_REPOSITORIES) return;
    setRepositoryUrls([...repositoryUrls, ""]);
    setErrors([...errors, ""]);
  };

  const handleRemoveRepository = (index: number) => {
    if (repositoryUrls.length <= 1) return; // Always keep at least one
    const newUrls = repositoryUrls.filter((_, i) => i !== index);
    const newErrors = errors.filter((_, i) => i !== index);
    setRepositoryUrls(newUrls);
    setErrors(newErrors);
  };

  const validateAllUrls = (): boolean => {
    const newErrors: string[] = [];
    let allValid = true;

    repositoryUrls.forEach((url, index) => {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        newErrors[index] = "Please enter a GitHub repository URL";
        allValid = false;
      } else if (!validateGitHubUrl(trimmedUrl)) {
        newErrors[index] = "Please enter a valid GitHub repository URL";
        allValid = false;
      } else {
        newErrors[index] = "";
      }
    });

    setErrors(newErrors);
    return allValid;
  };

  const areAllUrlsValid = (): boolean => {
    return repositoryUrls.every(url => {
      const trimmed = url.trim();
      return trimmed && validateGitHubUrl(trimmed);
    });
  };

  const createWorkspaceAutomatically = async (repoUrl: string) => {
    if (isCreatingRef.current) return;

    setIsCreatingWorkspace(true);
    setCreationStatus("Creating your workspace...");
    isCreatingRef.current = true;

    try {
      // Extract repo name from first URL for workspace naming
      const repoName = extractRepoNameFromUrl(repoUrl.split(',')[0].trim());
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

      // Create workspace with comma-separated repository URLs
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          description: '',
          slug: projectName,
          repositoryUrl: repoUrl, // Already comma-separated
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create workspace");
      }

      if (data?.workspace?.slug && data?.workspace?.id) {
        await refreshWorkspaces();

        // Update lastAccessedAt for the new workspace to ensure proper workspace selection
        fetch(`/api/workspaces/${data.workspace.slug}/access`, {
          method: "POST",
        }).catch(console.error);

        // Check GitHub App status for first repository
        const firstRepoUrl = repoUrl.split(',')[0].trim();
        const statusResponse = await fetch(`/api/github/app/check?repositoryUrl=${encodeURIComponent(firstRepoUrl)}`);
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
              repositoryUrl: firstRepoUrl
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
      const errorMessage = error instanceof Error ? error.message : "Failed to create workspace";
      // Set error on first repository
      const newErrors = [...errors];
      newErrors[0] = errorMessage;
      setErrors(newErrors);
      setIsCreatingWorkspace(false);
      isCreatingRef.current = false;
    }
  };

  const handleNext = () => {
    // Validate all URLs first
    if (!validateAllUrls()) {
      return;
    }

    // Trim and clean all URLs, then join with comma
    const trimmedUrls = repositoryUrls.map(url => url.trim().replace(/\/$/, ""));
    const repoUrlString = trimmedUrls.join(',');

    // Store first URL in localStorage for backward compatibility
    localStorage.setItem("repoUrl", trimmedUrls[0]);

    // Check if user is authenticated
    if (!session?.user) {
      // Not authenticated - show auth modal
      setPendingRepoUrl(repoUrlString);
      setShowAuthModal(true);
      return;
    }

    // Already authenticated - create workspace immediately
    createWorkspaceAutomatically(repoUrlString);
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
            {/* Repository URLs Input List */}
            <div className="max-w-md mx-auto space-y-4">
              <div className="space-y-3">
                {repositoryUrls.map((url, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        {repositoryUrls.length > 1 && (
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground font-medium">
                              Repository {index + 1}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Input
                            id={`repository-url-${index}`}
                            type="url"
                            placeholder="https://github.com/username/repository"
                            value={url}
                            onChange={(e) => handleRepositoryUrlChange(index, e.target.value)}
                            onKeyDown={handleKeyDown}
                            className={errors[index] ? "border-red-500 focus:border-red-500" : ""}
                            disabled={isCreatingWorkspace}
                          />
                          {/* Show Add button on first input when valid URL is entered and < max repos */}
                          {index === 0 && validateGitHubUrl(url) && repositoryUrls.length < MAX_REPOSITORIES && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={handleAddRepository}
                              disabled={isCreatingWorkspace}
                              className="h-10 w-10 shrink-0"
                              title="Add another repository"
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          )}
                          {/* Show Remove button for additional repos */}
                          {index > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveRepository(index)}
                              disabled={isCreatingWorkspace}
                              className="h-10 w-10 shrink-0"
                              title="Remove repository"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    {errors[index] && (
                      <div className="flex items-center gap-2 text-red-600 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        <span>{errors[index]}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-3">
              <Button 
                onClick={handleNext} 
                className="px-8 py-3" 
                disabled={!areAllUrlsValid() || isCreatingWorkspace}
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
