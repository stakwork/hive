"use client";

import { useState, useEffect } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useToast } from "@/components/ui/use-toast";
import { redirect } from "next/navigation";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";
import { PageHeader } from "@/components/ui/page-header";
import { RecommendationsSection } from "@/components/insights/RecommendationsSection";
import { JanitorSection, JanitorItem } from "@/components/insights/JanitorSection";
import { BarChart3, TestTube, Wrench, Shield, FlaskConical, Zap, Type, BookOpen, Package, GitPullRequest } from "lucide-react";

// Testing janitors - real data
const testingJanitors: JanitorItem[] = [
  { 
    id: "UNIT_TESTS", 
    name: "Unit Tests", 
    icon: FlaskConical, 
    description: "Identify missing unit tests.",
    configKey: "unitTestsEnabled"
  },
  { 
    id: "INTEGRATION_TESTS", 
    name: "Integration Tests", 
    icon: Zap, 
    description: "Identify missing integration tests.",
    configKey: "integrationTestsEnabled"
  },
];

// Maintainability janitors - coming soon
const maintainabilityJanitors: JanitorItem[] = [
  { id: "refactoring", name: "Refactoring", icon: Wrench, description: "Identify refactoring opportunities." },
  { id: "semantic", name: "Semantic Renaming", icon: Type, description: "Suggest better variable names." },
  { id: "documentation", name: "Documentation", icon: BookOpen, description: "Generate missing documentation." },
];

// Security janitors - coming soon  
const securityJanitors: JanitorItem[] = [
  { id: "security", name: "Security Scan", icon: Shield, description: "Scan for vulnerabilities." },
  { id: "supply-chain", name: "Supply Chain", icon: Package, description: "Check dependencies risk." },
  { id: "pr-reviews", name: "PR Reviews", icon: GitPullRequest, description: "Enable automatic PR reviews." },
];

export default function InsightsPage() {
  const canAccessInsights = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  
  // State for real data
  const [janitorConfig, setJanitorConfig] = useState<Record<string, boolean> | null>(null);
  const [recommendations, setRecommendations] = useState<{
    id: string;
    title: string;
    description: string;
    impact?: string;
    priority: string;
    janitorRun?: { type: string };
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningJanitors, setRunningJanitors] = useState<Set<string>>(new Set());
  
  // State for hardcoded janitors
  const [hardcodedStates, setHardcodedStates] = useState<Record<string, boolean>>({
    refactoring: false,
    semantic: false,
    documentation: false,
    security: false,
    'supply-chain': false,
    'pr-reviews': false
  });
  
  const [dismissedSuggestions, setDismissedSuggestions] = useState(new Set<string>());
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



  return (
    <div className="container mx-auto p-6 space-y-8 max-w-4xl">
      <PageHeader
        title="Insights"
        description="Automated codebase analysis and recommendations"
        icon={BarChart3}
      />

      <TestCoverageCard />

      <RecommendationsSection
        recommendations={recommendations}
        loading={loading}
        dismissedSuggestions={dismissedSuggestions}
        showAll={showAll}
        onDismiss={handleDismiss}
        onAccept={handleAccept}
        onShowAll={() => setShowAll(true)}
      />

      <JanitorSection
        title="Testing"
        description="Automated testing recommendations and coverage analysis"
        icon={<TestTube className="h-5 w-5 text-blue-500" />}
        janitors={testingJanitors}
        janitorConfig={janitorConfig}
        runningJanitors={runningJanitors}
        loading={loading}
        onToggleJanitor={toggleTestingJanitor}
        onRunManually={runJanitorManually}
      />

      <JanitorSection
        title="Maintainability"
        description="Code quality and maintainability improvements (Coming soon)"
        icon={<Wrench className="h-5 w-5 text-orange-500" />}
        janitors={maintainabilityJanitors}
        hardcodedStates={hardcodedStates}
        comingSoon={true}
      />

      <JanitorSection
        title="Security"
        description="Security scanning and vulnerability detection (Coming soon)"
        icon={<Shield className="h-5 w-5 text-red-500" />}
        janitors={securityJanitors}
        hardcodedStates={hardcodedStates}
        comingSoon={true}
      />
    </div>
  );
}