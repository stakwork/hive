import { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { LucideIcon, Loader2, Play, Clock } from "lucide-react";

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
  // For real janitors (like testing)
  janitorConfig?: Record<string, boolean> | null;
  runningJanitors?: Set<string>;
  loading?: boolean;
  onToggleJanitor?: (configKey: string) => Promise<void>;
  onRunManually?: (janitorType: string) => Promise<void>;
  // For hardcoded janitors (like maintainability/security)
  hardcodedStates?: Record<string, boolean>;
  comingSoon?: boolean;
}

export function JanitorSection({
  title,
  description,
  icon,
  janitors,
  janitorConfig,
  runningJanitors = new Set(),
  loading = false,
  onToggleJanitor,
  onRunManually,
  hardcodedStates,
  comingSoon = false
}: JanitorSectionProps) {
  const getStatusBadge = (isOn: boolean) => {
    if (comingSoon) return <Badge variant="outline" className="text-xs text-gray-500">Coming Soon</Badge>;
    if (isOn) return <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>;
    return <Badge variant="outline" className="text-gray-600 border-gray-300">Idle</Badge>;
  };

  const getJanitorState = (janitor: JanitorItem): boolean => {
    if (comingSoon) return false;
    if (janitor.configKey && janitorConfig) {
      return janitorConfig[janitor.configKey] || false;
    }
    if (hardcodedStates) {
      return hardcodedStates[janitor.id] || false;
    }
    return false;
  };

  const isJanitorRunning = (janitor: JanitorItem): boolean => {
    return runningJanitors.has(janitor.id);
  };

  const handleToggle = async (janitor: JanitorItem) => {
    if (comingSoon) return;
    if (janitor.configKey && onToggleJanitor) {
      await onToggleJanitor(janitor.configKey);
    }
  };

  const handleManualRun = async (janitor: JanitorItem) => {
    if (comingSoon || !onRunManually) return;
    await onRunManually(janitor.id);
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
                      {getStatusBadge(isOn)}
                    </div>
                    <p className="text-xs text-muted-foreground">{janitor.description}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {comingSoon ? (
                    <Clock className="h-4 w-4 text-gray-400" />
                  ) : (
                    isOn && onRunManually && (
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