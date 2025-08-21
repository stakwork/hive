import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, TestTube, Wrench, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";

interface Recommendation {
  id: string;
  title: string;
  description: string;
  impact?: string;
  priority: string;
  janitorRun?: {
    type: string;
  };
}

interface RecommendationsSectionProps {
  // Optional trigger to refresh recommendations
  refreshTrigger?: number;
}

export function RecommendationsSection({ refreshTrigger }: RecommendationsSectionProps = {}) {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedSuggestions, setDismissedSuggestions] = useState(new Set<string>());
  const [showAll, setShowAll] = useState(false);

  // Fetch recommendations
  useEffect(() => {
    if (!workspace?.slug) return;
    
    const fetchRecommendations = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/workspaces/${workspace.slug}/janitors/recommendations?limit=3`);
        if (response.ok) {
          const data = await response.json();
          setRecommendations(data.recommendations);
        }
      } catch (error) {
        console.error("Error fetching recommendations:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRecommendations();
  }, [workspace?.slug, refreshTrigger]);

  const handleAccept = async (recommendationId: string) => {
    try {
      const response = await fetch(`/api/janitors/recommendations/${recommendationId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      
      if (response.ok) {
        setDismissedSuggestions(prev => new Set([...prev, recommendationId]));
        const result = await response.json();
        if (result.task) {
          toast({
            title: "Recommendation accepted!",
            description: "Task created successfully. You can view it in the tasks section.",
          });
        }
      } else {
        const error = await response.json();
        console.error("Accept failed:", error);
        toast({
          title: "Failed to accept recommendation",
          description: error.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error accepting recommendation:", error);
      toast({
        title: "Failed to accept recommendation",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDismiss = async (recommendationId: string) => {
    try {
      const response = await fetch(`/api/janitors/recommendations/${recommendationId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      
      if (response.ok) {
        setDismissedSuggestions(prev => new Set([...prev, recommendationId]));
        await response.json();
        toast({
          title: "Recommendation dismissed",
          description: "Recommendation has been removed from your list.",
        });
      } else {
        const error = await response.json();
        console.error("Dismiss failed:", error);
        toast({
          title: "Failed to dismiss recommendation",
          description: error.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error dismissing recommendation:", error);
      toast({
        title: "Failed to dismiss recommendation", 
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };
  const visibleRecommendations = recommendations.filter(r => !dismissedSuggestions.has(r.id));
  const displayedRecommendations = showAll ? visibleRecommendations : visibleRecommendations.slice(0, 3);

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-200">Critical</Badge>;
      case 'HIGH': return <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-200">High</Badge>;
      case 'MEDIUM': return <Badge className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-200">Medium</Badge>;
      case 'LOW': return <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200">Low</Badge>;
      default: return <Badge variant="outline" className="text-xs">Unknown</Badge>;
    }
  };

  const getRecommendationIcon = (janitorType?: string) => {
    switch (janitorType) {
      case 'UNIT_TESTS': return TestTube;
      case 'INTEGRATION_TESTS': return Wrench;
      default: return CheckCircle2;
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
          Our janitors have been hard at work. They&apos;ve analyzed your codebase and prepared these recommendations for your review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading recommendations...</p>
          </div>
        ) : displayedRecommendations.length > 0 ? (
          displayedRecommendations.map((recommendation) => {
            const Icon = getRecommendationIcon(recommendation.janitorRun?.type);
            return (
              <div key={recommendation.id} className="p-3 border rounded-lg hover:bg-muted transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium line-clamp-1">
                      {recommendation.title}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPriorityBadge(recommendation.priority)}
                  </div>
                </div>
                
                <p className="text-xs text-muted-foreground mb-3">{recommendation.description}</p>
                {recommendation.impact && (
                  <p className="text-xs text-blue-600 mb-3">Impact: {recommendation.impact}</p>
                )}
                
                <div className="flex items-center justify-start">
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-7 text-xs"
                      onClick={() => handleDismiss(recommendation.id)}
                    >
                      Dismiss
                    </Button>
                    <Button 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => handleAccept(recommendation.id)}
                    >
                      Accept
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No recommendations available!</p>
          </div>
        )}
        
        {!loading && visibleRecommendations.length > 3 && !showAll && (
          <div className="pt-2 text-center">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setShowAll(true)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Show {visibleRecommendations.length - 3} more recommendations
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}