import { ReactNode, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { LucideIcon, Loader2, Play, Clock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useInsightsStore } from "@/stores/useInsightsStore";

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
  comingSoon = false
}: JanitorSectionProps) {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  
  // Get state and actions from store
  const {
    janitorConfig,
    loading,
    runningJanitors,
    fetchJanitorConfig,
    toggleJanitor,
    runJanitor
  } = useInsightsStore();

  // Fetch janitor config for real janitors
  useEffect(() => {
    if (workspace?.slug && !comingSoon) {
      fetchJanitorConfig(workspace.slug);
    }
  }, [workspace?.slug, comingSoon, fetchJanitorConfig]);

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
      await toggleJanitor(workspace.slug, janitor.configKey);
    } catch (error) {
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
      await runJanitor(workspace.slug, janitor.id);
      toast({
        title: "Janitor run started!",
        description: "The janitor is now analyzing your codebase.",
      });
    } catch (error) {
      toast({
        title: "Failed to start janitor run",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
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