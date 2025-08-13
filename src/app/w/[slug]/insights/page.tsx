"use client";

import { useState } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { 
  BarChart3, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  FileText,
  TestTube,
  Shield,
  Wrench,
  Eye,
  GitPullRequest,
  Package,
  Database,
  Type,
  Loader2,
  PlayCircle,
  PauseCircle,
  FlaskConical,
  Globe,
  Target,
  BookOpen,
  Zap,
  Search
} from "lucide-react";
import { redirect } from "next/navigation";

const topSuggestions = [
  {
    id: 1,
    priority: "high",
    title: "Add test coverage for payment logic",
    description: "We found calculatePayment() in src/billing/core.ts could benefit from unit tests to ensure reliability",
    impact: "Prevents payment calculation bugs",
    icon: TestTube,
    color: "blue"
  },
  {
    id: 2,
    priority: "medium", 
    title: "Split UserDashboard into smaller components",
    description: "This 450-line component could be more maintainable as 3 focused components",
    impact: "Easier to maintain and test",
    icon: Wrench,
    color: "orange"
  },
  {
    id: 3,
    priority: "low",
    title: "Upgrade TypeScript to v5.3",
    description: "Newer version available with performance improvements and better type inference",
    impact: "Enhanced developer experience",
    icon: Package,
    color: "green"
  }
];

const agents = [
  { id: 1, name: "Documentation", icon: BookOpen, status: "running", progress: 73, description: "Generate missing documentation." },
  { id: 2, name: "Unit Tests", icon: FlaskConical, status: "idle", progress: 0, description: "Identify missing unit tests." },
  { id: 3, name: "Integration Tests", icon: Zap, status: "running", progress: 28, description: "Identify missing integration tests." },
  { id: 4, name: "E2E Tests", icon: Globe, status: "idle", progress: 0, description: "Identify missing end-to-end tests." },
  { id: 5, name: "Refactoring", icon: Wrench, status: "completed", progress: 100, description: "Identify refactoring opportunities." },
  { id: 6, name: "PR Reviews", icon: GitPullRequest, status: "idle", progress: 0, description: "Enable automatic PR reviews." },
  { id: 7, name: "Security", icon: Shield, status: "completed", progress: 100, description: "Scan for vulnerabilities." },
  { id: 8, name: "Supply Chain", icon: Package, status: "running", progress: 60, description: "Check dependencies risk." },
  { id: 9, name: "Semantic Renaming", icon: Type, status: "running", progress: 35, description: "Suggest better variable names." },
];

export default function InsightsPage() {
  const canAccessInsights = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const [agentStates, setAgentStates] = useState<Record<number, boolean>>(
    agents.reduce((acc, agent) => ({ ...acc, [agent.id]: agent.status !== 'idle' }), {} as Record<number, boolean>)
  );
  const [dismissedSuggestions, setDismissedSuggestions] = useState(new Set());
  const [showAll, setShowAll] = useState(false);

  if (!canAccessInsights) {
    redirect("/");
  }

  const handleAccept = (suggestionId: number) => {
    setDismissedSuggestions(prev => new Set([...prev, suggestionId]));
  };

  const handleDismiss = (suggestionId: number) => {
    setDismissedSuggestions(prev => new Set([...prev, suggestionId]));
  };

  const visibleSuggestions = topSuggestions.filter(s => !dismissedSuggestions.has(s.id));
  const displayedSuggestions = showAll ? visibleSuggestions : visibleSuggestions.slice(0, 3);

  const toggleAgent = (agentId: number) => {
    setAgentStates(prev => ({ ...prev, [agentId]: !prev[agentId] }));
  };

  const getStatusIcon = (isOn: boolean) => {
    if (isOn) return <Loader2 className="h-4 w-4 text-green-500 animate-spin" />;
    return <Clock className="h-4 w-4 text-gray-400" />;
  };

  const getStatusBadge = (isOn: boolean) => {
    if (isOn) return <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>;
    return <Badge variant="outline" className="text-gray-600 border-gray-300">Idle</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high': return <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-200">High</Badge>;
      case 'medium': return <Badge className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-200">Medium</Badge>;
      case 'low': return <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200">Low</Badge>;
      default: return <Badge variant="outline" className="text-xs">Unknown</Badge>;
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

      {/* Top 3 Priority Suggestions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span>Recommendations</span>
          </CardTitle>
          <CardDescription>
            Our janitors have been hard at work. They've analyzed your codebase and prepared these recommendations for your review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {displayedSuggestions.map((suggestion) => {
            const Icon = suggestion.icon;
            return (
              <div key={suggestion.id} className="p-3 border rounded-lg hover:bg-muted transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium line-clamp-1">
                      {suggestion.title}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPriorityBadge(suggestion.priority)}
                  </div>
                </div>
                
                <p className="text-xs text-muted-foreground mb-3">{suggestion.description}</p>
                
                <div className="flex items-center justify-start">
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-7 text-xs"
                      onClick={() => handleDismiss(suggestion.id)}
                    >
                      Dismiss
                    </Button>
                    <Button 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => handleAccept(suggestion.id)}
                    >
                      Accept
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          
          {visibleSuggestions.length > 3 && !showAll && (
            <div className="pt-2 text-center">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowAll(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Show {visibleSuggestions.length - 3} more suggestions
              </Button>
            </div>
          )}
          
          {visibleSuggestions.length === 0 && (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">All suggestions reviewed!</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Janitors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Wrench className="h-5 w-5 text-purple-500" />
            <span>Janitors</span>
          </CardTitle>
          <CardDescription>
            Tireless workers keeping your codebase clean, tested, and secure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {agents.map((agent) => {
              const Icon = agent.icon;
              const isOn = agentStates[agent.id];
              
              return (
                <div key={agent.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
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
                        <span className="font-medium text-sm">{agent.name}</span>
                        {getStatusBadge(isOn)}
                      </div>
                      <p className="text-xs text-muted-foreground">{agent.description}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(isOn)}
                    <Switch
                      checked={isOn}
                      onCheckedChange={() => toggleAgent(agent.id)}
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