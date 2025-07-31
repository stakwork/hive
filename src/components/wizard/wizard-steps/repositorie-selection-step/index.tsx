import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Github,
  CheckCircle,
  ArrowRight,
  Search,
  Star,
  Eye,
} from "lucide-react";
import { Repository } from "@/types/wizard";
import { useEffect, useState } from "react";
import { mockRepositories } from "@/data/mockRepositories";
import { useWizardStore } from "@/stores/useWizardStore";

interface RepositorySelectionStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function RepositorySelectionStep({
  onNext,
  onBack,
}: RepositorySelectionStepProps) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAppIntegration, setCheckingAppIntegration] = useState(false);
  const [appIntegrationStatus, setAppIntegrationStatus] = useState<{
    status: "linked" | "not_linked" | "error";
    installationUrl?: string;
    message?: string;
  } | null>(null);
  const { selectedRepo, setSelectedRepo } = useWizardStore((s) => s);

  useEffect(() => {
    const fetchRepositories = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/github/repositories");
        if (response.ok) {
          const data = await response.json();
          setRepositories(data.repositories || []);
        } else {
          // Fallback to mock data for testing
          setRepositories(mockRepositories);
        }
      } catch (error) {
        console.error("Failed to fetch repositories:", error);
        // Fallback to mock data for testing
        setRepositories(mockRepositories);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRepositories();
  }, []);

  const checkGitHubAppIntegration = async (repo: Repository) => {
    setCheckingAppIntegration(true);
    setAppIntegrationStatus(null);

    try {
      const response = await fetch("/api/github/app-integration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repositoryId: repo.id.toString(),
          repositoryName: repo.name,
          repositoryOwner: repo.full_name?.split("/")[0],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setAppIntegrationStatus({
          status: "error",
          message: data.error || "Failed to check GitHub App integration",
        });
        return;
      }

      setAppIntegrationStatus(data);
    } catch (error) {
      console.error("Error checking GitHub App integration:", error);
      setAppIntegrationStatus({
        status: "error",
        message: "Failed to check GitHub App integration",
      });
    } finally {
      setCheckingAppIntegration(false);
    }
  };

  const handleRepositorySelect = async (repo: Repository) => {
    setSelectedRepo(repo);
    await checkGitHubAppIntegration(repo);
  };

  const handleLinkApp = () => {
    if (appIntegrationStatus?.installationUrl) {
      window.open(
        appIntegrationStatus.installationUrl,
        "_blank",
        "width=800,height=600",
      );
      // Optionally refresh the integration status after some time
      setTimeout(() => {
        if (selectedRepo) {
          checkGitHubAppIntegration(selectedRepo);
        }
      }, 3000);
    }
  };

  const filteredRepositories = repositories.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      repo.description?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <Card className="max-w-4xl mx-auto bg-card text-card-foreground">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="w-5 h-5" />
          Select Repository
        </CardTitle>
        <CardDescription>
          Choose a repository to analyze with Code Graph
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search repositories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Repository List */}
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">
                Loading repositories...
              </p>
            </div>
          ) : filteredRepositories.length === 0 ? (
            <div className="text-center py-8">
              <Github className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">No repositories found</p>
            </div>
          ) : (
            filteredRepositories.map((repo) => (
              <div
                key={repo.id}
                className={`p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md ${
                  selectedRepo?.id === repo.id
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-muted hover:border-accent"
                }`}
                onClick={() => handleRepositorySelect(repo)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-foreground">
                        {repo.name}
                      </h3>
                      {repo.private && (
                        <Badge variant="secondary" className="text-xs">
                          Private
                        </Badge>
                      )}
                      {repo.fork && (
                        <Badge variant="outline" className="text-xs">
                          Fork
                        </Badge>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {repo.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {repo.language && (
                        <span className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full"></div>
                          {repo.language}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        {repo.stargazers_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {repo.watchers_count}
                      </span>
                    </div>
                  </div>
                  {selectedRepo?.id === repo.id && (
                    <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-300" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* GitHub App Integration Status */}
        {selectedRepo && (
          <div className="border-t pt-4">
            <h4 className="font-medium text-foreground mb-2">
              GitHub App Integration
            </h4>
            {checkingAppIntegration ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-sm">Checking app integration...</span>
              </div>
            ) : appIntegrationStatus ? (
              <div className="space-y-2">
                {appIntegrationStatus.status === "linked" ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">
                      Repository is linked to GitHub App
                    </span>
                  </div>
                ) : appIntegrationStatus.status === "not_linked" ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                      <Github className="w-4 h-4" />
                      <span className="text-sm">
                        {appIntegrationStatus.message}
                      </span>
                    </div>
                    <Button
                      onClick={handleLinkApp}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                    >
                      Link GitHub App
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <span className="text-sm">
                      {appIntegrationStatus.message}
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button
            onClick={onNext}
            disabled={
              !selectedRepo || appIntegrationStatus?.status !== "linked"
            }
            className="px-8"
          >
            Continue
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
