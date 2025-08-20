"use client";

import { useState, useEffect } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { 
  BarChart3, 
  CheckCircle2, 
  Clock,
  TestTube,
  Shield,
  Wrench,
  GitPullRequest,
  Package,
  Type,
  Loader2,
  FlaskConical,
  Globe,
  BookOpen,
  Zap,
  Bot,
  Play
} from "lucide-react";
import { redirect } from "next/navigation";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";

// Testing janitors - fetch real data
const testingJanitors = [
  { 
    id: "UNIT_TESTS", 
    name: "Unit Tests", 
    icon: FlaskConical, 
    description: "Identify missing unit tests.",
    configKey: "unitTestsEnabled" as const
  },
  { 
    id: "INTEGRATION_TESTS", 
    name: "Integration Tests", 
    icon: Zap, 
    description: "Identify missing integration tests.",
    configKey: "integrationTestsEnabled" as const
  },
];

// Hardcoded for v1
const maintainabilityJanitors = [
  { id: "refactoring", name: "Refactoring", icon: Wrench, status: "idle", description: "Identify refactoring opportunities." },
  { id: "semantic", name: "Semantic Renaming", icon: Type, status: "idle", description: "Suggest better variable names." },
  { id: "documentation", name: "Documentation", icon: BookOpen, status: "idle", description: "Generate missing documentation." },
];

const securityJanitors = [
  { id: "security", name: "Security Scan", icon: Shield, status: "idle", description: "Scan for vulnerabilities." },
  { id: "supply-chain", name: "Supply Chain", icon: Package, status: "idle", description: "Check dependencies risk." },
  { id: "pr-reviews", name: "PR Reviews", icon: GitPullRequest, status: "idle", description: "Enable automatic PR reviews." },
];

export default function InsightsPage() {
  const canAccessInsights = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  
  // State for real data
  const [janitorConfig, setJanitorConfig] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningJanitors, setRunningJanitors] = useState<Set<string>>(new Set());
  
  // State for hardcoded janitors
  const [hardcodedStates, setHardcodedStates] = useState<Record<string, boolean>>(
    [...maintainabilityJanitors, ...securityJanitors].reduce((acc, janitor) => ({ ...acc, [janitor.id]: false }), {})
  );
  
  const [dismissedSuggestions, setDismissedSuggestions] = useState(new Set());
  const [showAll, setShowAll] = useState(false);

  if (!canAccessInsights) {
    redirect("/");
  }

  // Fetch janitor config and recommendations
  useEffect(() => {
    if (!workspace?.slug) return;
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch janitor config
        const configResponse = await fetch(`/api/workspaces/${workspace.slug}/janitors/config`);
        if (configResponse.ok) {
          const configData = await configResponse.json();
          setJanitorConfig(configData.config);
        }
        
        // Fetch recommendations (top 3 by priority)
        const recsResponse = await fetch(`/api/workspaces/${workspace.slug}/janitors/recommendations?limit=3`);
        if (recsResponse.ok) {
          const recsData = await recsResponse.json();
          setRecommendations(recsData.recommendations);
        }
        
      } catch (error) {
        console.error("Error fetching janitor data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [workspace?.slug]);

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
        const result = await response.json();
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

  const toggleTestingJanitor = async (configKey: string) => {
    if (!janitorConfig || !workspace?.slug) return;
    
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/janitors/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [configKey]: !janitorConfig[configKey]
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setJanitorConfig(data.config);
      }
    } catch (error) {
      console.error("Error updating janitor config:", error);
    }
  };

  const toggleHardcodedJanitor = (janitorId: string) => {
    setHardcodedStates(prev => ({ ...prev, [janitorId]: !prev[janitorId] }));
  };

  const runJanitorManually = async (janitorType: string) => {
    if (!workspace?.slug) return;
    
    try {
      setRunningJanitors(prev => new Set([...prev, janitorType]));
      
      const response = await fetch(`/api/workspaces/${workspace.slug}/janitors/${janitorType}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      if (response.ok) {
        toast({
          title: "Janitor run started!",
          description: "The janitor is now analyzing your codebase.",
        });
        
        // Refresh recommendations after a short delay to potentially show new results
        setTimeout(() => {
          fetchRecommendations();
        }, 2000);
      } else {
        const error = await response.json();
        toast({
          title: "Failed to start janitor run",
          description: error.error || 'Unknown error',
          variant: "destructive",
        });
        
        // Log the error for debugging
        console.error("Janitor run failed:", error);
      }
    } catch (error) {
      console.error("Error running janitor:", error);
      toast({
        title: "Failed to start janitor run",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRunningJanitors(prev => {
        const newSet = new Set(prev);
        newSet.delete(janitorType);
        return newSet;
      });
    }
  };

  const fetchRecommendations = async () => {
    if (!workspace?.slug) return;
    
    try {
      const recsResponse = await fetch(`/api/workspaces/${workspace.slug}/janitors/recommendations?limit=3`);
      if (recsResponse.ok) {
        const recsData = await recsResponse.json();
        setRecommendations(recsData.recommendations);
      }
    } catch (error) {
      console.error("Error fetching recommendations:", error);
    }
  };


  const getStatusBadge = (isOn: boolean) => {
    if (isOn) return <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>;
    return <Badge variant="outline" className="text-gray-600 border-gray-300">Idle</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-200">Critical</Badge>;
      case 'HIGH': return <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-200">High</Badge>;
      case 'MEDIUM': return <Badge className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-200">Medium</Badge>;
      case 'LOW': return <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200">Low</Badge>;
      default: return <Badge variant="outline" className="text-xs">Unknown</Badge>;
    }
  };

  const getRecommendationIcon = (janitorType: string) => {
    switch (janitorType) {
      case 'UNIT_TESTS': return TestTube;
      case 'INTEGRATION_TESTS': return Wrench;
      default: return CheckCircle2;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <BarChart3 className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold">Insights</h1>
          <p className="text-muted-foreground">Automated codebase analysis and recommendations</p>
        </div>
      </div>

      {/* Test Coverage */}
      <TestCoverageCard />

      {/* Top 3 Priority Suggestions */}
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

      {/* Testing Janitors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Testing</span>
          </CardTitle>
          <CardDescription>
            Automated testing recommendations and coverage analysis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {testingJanitors.map((janitor) => {
              const Icon = janitor.icon;
              const isOn = janitorConfig?.[janitor.configKey] || false;
              const isRunning = runningJanitors.has(janitor.id);
              
              return (
                <div key={janitor.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                  <div className="flex items-center space-x-3 flex-1">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${
                      isOn 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-background border-gray-200'
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        isOn 
                          ? 'text-green-600' 
                          : 'text-muted-foreground'
                      }`} />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="font-medium text-sm">{janitor.name}</span>
                        {getStatusBadge(isOn)}
                      </div>
                      <p className="text-xs text-muted-foreground">{janitor.description}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {isOn && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => runJanitorManually(janitor.id)}
                            disabled={isRunning || loading}
                          >
                            {isRunning ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Manually run</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Switch
                      checked={isOn}
                      onCheckedChange={() => toggleTestingJanitor(janitor.configKey)}
                      className="data-[state=checked]:bg-green-500"
                      disabled={loading}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Maintainability Janitors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Wrench className="h-5 w-5 text-orange-500" />
            <span>Maintainability</span>
          </CardTitle>
          <CardDescription>
            Code quality and maintainability improvements (Coming soon)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {maintainabilityJanitors.map((janitor) => {
              const Icon = janitor.icon;
              const isOn = hardcodedStates[janitor.id];
              
              return (
                <div key={janitor.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors opacity-60">
                  <div className="flex items-center space-x-3 flex-1">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${
                      isOn 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-background border-gray-200'
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        isOn 
                          ? 'text-green-600' 
                          : 'text-muted-foreground'
                      }`} />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="font-medium text-sm">{janitor.name}</span>
                        <Badge variant="outline" className="text-xs text-gray-500">Coming Soon</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{janitor.description}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <Switch
                      checked={false}
                      disabled={true}
                      className="data-[state=checked]:bg-green-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Security Janitors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5 text-red-500" />
            <span>Security</span>
          </CardTitle>
          <CardDescription>
            Security scanning and vulnerability detection (Coming soon)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {securityJanitors.map((janitor) => {
              const Icon = janitor.icon;
              const isOn = hardcodedStates[janitor.id];
              
              return (
                <div key={janitor.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors opacity-60">
                  <div className="flex items-center space-x-3 flex-1">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${
                      isOn 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-background border-gray-200'
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        isOn 
                          ? 'text-green-600' 
                          : 'text-muted-foreground'
                      }`} />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="font-medium text-sm">{janitor.name}</span>
                        <Badge variant="outline" className="text-xs text-gray-500">Coming Soon</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{janitor.description}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <Switch
                      checked={false}
                      disabled={true}
                      className="data-[state=checked]:bg-green-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}