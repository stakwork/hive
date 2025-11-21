import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SupportedLanguages } from "@/lib/constants";
import { AlertCircle, ArrowRight, UserPlus } from "lucide-react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useState } from "react";

interface WelcomeStepProps {
  onNext: (repositoryUrl?: string) => void;
}

export const WelcomeStep = ({ onNext }: WelcomeStepProps) => {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [error, setError] = useState("");
  const { data: session } = useSession();
  const router = useRouter();

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

    onNext(trimmedUrl);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
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
            <Image src="/apple-touch-icon.png" alt="Hive" width={40} height={40} />
          </div>
          <CardTitle className="text-2xl">Welcome to Hive</CardTitle>
          <CardDescription className="text-lg">Paste your GitHub repository to get started</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Repository URL Input */}
          <div className="max-w-md mx-auto">
            <Input
              id="repository-url"
              type="url"
              placeholder="https://github.com/username/repository"
              value={repositoryUrl}
              onChange={(e) => handleRepositoryUrlChange(e.target.value)}
              onKeyPress={handleKeyPress}
              className={`pr-10 ${error ? "border-red-500 focus:border-red-500" : ""}`}
            />
            {error && (
              <div className="flex items-center gap-2 mt-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-3">
            <Button onClick={handleNext} className="px-8 py-3" disabled={!repositoryUrl.trim()}>
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

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
          <button onClick={redirectToLogin} className="hover:text-primary transition-colors">
            Sign in
          </button>
          <span>·</span>
          <button onClick={createAccountOnly} className="hover:text-primary transition-colors">
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
    </div>
  );
};
