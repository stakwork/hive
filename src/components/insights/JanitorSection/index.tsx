import { ReactNode, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { LucideIcon, Loader2, Play, Clock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";

export interface JanitorItem {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  configKey?: string;
}

export interface JanitorSectionProps {
  title: string;
  description: string;
  icon: ReactNode;
  janitors: JanitorItem[];
  comingSoon?: boolean;
  // Optional callback when recommendations are updated
  onRecommendationsUpdate?: () => void;
}

const getStatusBadge = (isOn: boolean, comingSoon: boolean) => {
  if (comingSoon) return <Badge variant="outline" className="text-xs text-gray-500">Coming Soon</Badge>;
  if (isOn) return <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>;
  return <Badge variant="outline" className="text-gray-600 border-gray-300">Idle</Badge>;
};

export function JanitorSection({
  title,
  description,
  icon,
  janitors,
  comingSoon = false,
  onRecommendationsUpdate
}: JanitorSectionProps) {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [janitorConfig, setJanitorConfig] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningJanitors, setRunningJanitors] = useState<Set<string>>(new Set());

  // Fetch janitor config for real janitors
  useEffect(() => {
    if (!workspace?.slug || comingSoon) return;
    
    const fetchConfig = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/workspaces/${workspace.slug}/janitors/config`);
        if (response.ok) {
          const data = await response.json();
          setJanitorConfig(data.config);
        }
      } catch (error) {
        console.error("Error fetching janitor config:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchConfig();
  }, [workspace?.slug, comingSoon]);

  const getJanitorState = (janitor: JanitorItem): boolean => {
    if (comingSoon) return false;
    if (janitor.configKey && janitorConfig) {
      return janitorConfig[janitor.configKey] || false;
    }
    return false;
  };

  const isJanitorRunning = (janitor: JanitorItem): boolean => {
    return runningJanitors.has(janitor.id);
  };

  const handleToggle = async (janitor: JanitorItem) => {
    if (comingSoon || !janitor.configKey || !workspace?.slug) return;
    
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/janitors/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [janitor.configKey]: !janitorConfig?.[janitor.configKey]
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setJanitorConfig(data.config);
      }
    } catch (error) {
      console.error("Error updating janitor config:", error);
      toast({
        title: "Failed to update janitor configuration",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleManualRun = async (janitor: JanitorItem) => {
    if (comingSoon || !workspace?.slug) return;
    
    try {
      setRunningJanitors(prev => new Set([...prev, janitor.id]));
      
      const response = await fetch(`/api/workspaces/${workspace.slug}/janitors/${janitor.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      if (response.ok) {
        toast({
          title: "Janitor run started!",
          description: "The janitor is now analyzing your codebase.",
        });
        
        // Notify parent to refresh recommendations immediately
        // The RecommendationsSection will handle its own loading state
        if (onRecommendationsUpdate) {
          onRecommendationsUpdate();
        }
      } else {
        const error = await response.json();
        toast({
          title: "Failed to start janitor run",
          description: error.error || 'Unknown error',
          variant: "destructive",
        });
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
        newSet.delete(janitor.id);
        return newSet;
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          {icon}
          <span>{title}</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {janitors.map((janitor) => {
            const Icon = janitor.icon;
            const isOn = getJanitorState(janitor);
            const isRunning = isJanitorRunning(janitor);
            
            return (
              <div 
                key={janitor.id} 
                className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors ${
                  comingSoon ? 'opacity-60' : ''
                }`}
              >
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
                      {getStatusBadge(isOn, comingSoon)}
                    </div>
                    <p className="text-xs text-muted-foreground">{janitor.description}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {comingSoon ? (
                    <Clock className="h-4 w-4 text-gray-400" />
                  ) : (
                    isOn && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleManualRun(janitor)}
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
                    )
                  )}
                  <Switch
                    checked={comingSoon ? false : isOn}
                    onCheckedChange={() => handleToggle(janitor)}
                    className="data-[state=checked]:bg-green-500"
                    disabled={comingSoon || loading}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}