import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, GitBranch, Loader2, Sparkles, Clock, User } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { getPriorityConfig, getJanitorIcon } from "@/lib/constants/janitor";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { JanitorType, Priority } from "@prisma/client";

export function RecommendationsSection() {
  const { workspace } = useWorkspace();
  // Get state and actions from store
  const {
    recommendations,
    recommendationsLoading: loading,
    showAll,
    janitorConfig,
    fetchRecommendations,
    acceptRecommendation,
    dismissRecommendation,
    setShowAll,
  } = useInsightsStore();

  // Fetch recommendations on mount
  useEffect(() => {
    if (workspace?.slug) {
      fetchRecommendations(workspace.slug);
    }
  }, [workspace?.slug, fetchRecommendations]);

  const handleAccept = async (recommendationId: string) => {
    try {
      const result = await acceptRecommendation(recommendationId);
      if (result.task) {
        toast("Recommendation accepted!", { description: "Task created successfully. You can view it in the tasks section." });
      }
    } catch (error) {
      toast.error("Failed to accept recommendation", { description: error instanceof Error ? error.message : "Please try again." });
    }
  };

  const handleDismiss = async (recommendationId: string) => {
    try {
      await dismissRecommendation(recommendationId);
      toast("Recommendation dismissed", { description: "Recommendation has been removed from your list." });
    } catch (error) {
      toast.error("Failed to dismiss recommendation", { description: error instanceof Error ? error.message : "Please try again." });
    }
  };

  const displayedRecommendations = showAll ? recommendations : recommendations.slice(0, 3);

  // Check if any janitors are enabled
  const hasEnabledJanitors = janitorConfig
    ? janitorConfig.unitTestsEnabled || janitorConfig.integrationTestsEnabled
    : false;

  const getPriorityBadge = (priority: Priority) => {
    const config = getPriorityConfig(priority);
    const colorClasses: Record<string, string> = {
      red: "bg-red-100 text-red-700 hover:bg-red-200",
      orange: "bg-orange-100 text-orange-700 hover:bg-orange-200",
      blue: "bg-blue-100 text-blue-700 hover:bg-blue-200",
      gray: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    };

    return (
      <Badge className={`text-xs ${colorClasses[config.color] || "bg-gray-100 text-gray-700"}`}>{config.label}</Badge>
    );
  };

  const getRecommendationIcon = (janitorType?: JanitorType) => {
    if (!janitorType) return CheckCircle2;
    try {
      return getJanitorIcon(janitorType);
    } catch {
      return CheckCircle2;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <span>Recommendations</span>
        </CardTitle>
        <CardDescription>
          Get automated code quality insights and improvement suggestions tailored to your codebase.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading recommendations...</p>
          </div>
        ) : !hasEnabledJanitors ? (
          <div className="text-center py-12">
            <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-blue-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Enable Automated Analysis</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Turn on code analysis to receive personalized recommendations for improving your codebase quality,
              performance, and maintainability.
            </p>
          </div>
        ) : displayedRecommendations.length > 0 ? (
          displayedRecommendations.map((recommendation) => {
            const Icon = getRecommendationIcon(recommendation.janitorRun?.janitorType as JanitorType);
            return (
              <div key={recommendation.id} className="p-3 border rounded-lg hover:bg-muted transition-colors" data-testid="recommendation-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium line-clamp-1" data-testid="recommendation-title">{recommendation.title}</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    {recommendation.createdAt && (
                      <span className="text-xs text-muted-foreground" data-testid="recommendation-timestamp">
                        {formatRelativeOrDate(recommendation.createdAt)}
                      </span>
                    )}
                    {!recommendation.janitorRun && (
                      <Badge className="gap-1 px-1.5 py-0.5 text-xs bg-purple-100 text-purple-800 border-purple-200" data-testid="recommendation-review-badge">
                        <User className="w-3 h-3" />
                        Review Required
                      </Badge>
                    )}
                    {recommendation.repository && (
                      <Badge variant="outline" className="gap-1 px-1.5 py-0.5 text-xs" data-testid="recommendation-repo-badge">
                        <GitBranch className="w-3 h-3" />
                        {recommendation.repository.name}
                      </Badge>
                    )}
                    {getPriorityBadge(recommendation.priority as Priority)}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mb-3" data-testid="recommendation-description">{recommendation.description}</p>
                {recommendation.impact && <p className="text-xs text-blue-600 mb-3" data-testid="recommendation-impact">Impact: {recommendation.impact}</p>}

                <div className="flex items-center justify-start">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleDismiss(recommendation.id)}
                      data-testid="recommendation-dismiss-button"
                    >
                      Dismiss
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => handleAccept(recommendation.id)} data-testid="recommendation-accept-button">
                      Accept
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12">
            <div className="mx-auto w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-4">
              <Clock className="h-8 w-8 text-orange-500 animate-pulse" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Analysis in Progress</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              We're currently scanning your codebase for potential improvements.
            </p>
          </div>
        )}

        {!loading && hasEnabledJanitors && recommendations.length > 3 && !showAll && (
          <div className="pt-2 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(true)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Show {recommendations.length - 3} more recommendations
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
