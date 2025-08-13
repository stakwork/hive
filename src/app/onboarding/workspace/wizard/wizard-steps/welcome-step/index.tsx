import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWizardStore } from "@/stores/useWizardStore";
import {
  AlertCircle,
  ArrowRight,
  Github,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useEffect, useState } from "react";

interface WelcomeStepProps {
  onNext: (repositoryUrl?: string) => void;
}

export const WelcomeStep = ({ onNext }: WelcomeStepProps) => {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const repositoryUrlDraft = useWizardStore((s) => s.repositoryUrlDraft);
  const [error, setError] = useState("");
  const setRepositoryUrlDraft = useWizardStore((s) => s.setRepositoryUrlDraft);
  const { data: session } = useSession();

  const validateGitHubUrl = (url: string): boolean => {
    // Basic GitHub URL validation
    const githubUrlPattern = /^https:\/\/github\.com\/[^\/]+\/[^\/]+(\/.*)?$/;
    return githubUrlPattern.test(url.trim());
  };


  const handleRepositoryUrlChange = (value: string) => {
    setRepositoryUrl(value);
    setError(""); // Clear error when user types
  };

  useEffect(() => {
    if (repositoryUrlDraft) {
      setRepositoryUrl(repositoryUrlDraft);
    }
  }, [repositoryUrlDraft]);

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

    setRepositoryUrlDraft(trimmedUrl);

    onNext(trimmedUrl);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleNext();
    }
  };

  const redirectToLogin = () => {
    redirect("/auth/signin");
  }

  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <Github className="w-8 h-8 text-blue-600 dark:text-blue-300" />
        </div>
        <CardTitle className="text-2xl">Welcome to Code Graph</CardTitle>
        <CardDescription className="text-lg">
          Enter your GitHub repository URL to get started
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Repository URL Input */}
        <div className="max-w-md mx-auto">
          <Label htmlFor="repository-url" className="text-sm font-medium mb-2 block text-left">
            GitHub Repository URL
          </Label>
          <div className="relative">
            <Input
              id="repository-url"
              type="url"
              placeholder="https://github.com/username/repository"
              value={repositoryUrl}
              onChange={(e) => handleRepositoryUrlChange(e.target.value)}
              onKeyPress={handleKeyPress}
              className={`pr-10 ${error ? 'border-red-500 focus:border-red-500' : ''}`}
            />
            {error && (
              <div className="flex items-center gap-2 mt-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-center">
          <Button
            onClick={handleNext}
            className="px-8 py-3"
            disabled={!repositoryUrl.trim()}
          >
            Get Started
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
      {!session?.user && <Button className="self-center" variant="outline" onClick={redirectToLogin}>
        I have an account
      </Button>}
    </Card>
  );
};
