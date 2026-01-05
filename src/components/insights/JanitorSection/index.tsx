import { useModal } from "@/components/modals/ModlaProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { JanitorType } from "@prisma/client";
import { Clock, Loader2, LucideIcon, Play } from "lucide-react";
import { ReactNode, useEffect } from "react";

export interface JanitorItem {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  configKey?: string;
  comingSoon?: boolean;
}

export interface JanitorSectionProps {
  title: string;
  description: string;
  icon: ReactNode;
  janitors: JanitorItem[];
  comingSoon?: boolean;
}

const getStatusBadge = (isOn: boolean, itemComingSoon: boolean, sectionComingSoon: boolean) => {
  if (itemComingSoon || sectionComingSoon) return <Badge variant="outline" className="text-xs text-gray-500">Coming Soon</Badge>;
  if (isOn) return <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>;
  return <Badge variant="outline" className="text-gray-600 border-gray-300">Idle</Badge>;
};

const canManuallyRun = (janitorId: string): boolean => {
  return Object.values(JanitorType).includes(janitorId as JanitorType);
};

export function JanitorSection({
  title,
  description,
  icon,
  janitors,
  comingSoon = false
}: JanitorSectionProps) {
  const { workspace } = useWorkspace();
  const open = useModal();

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
    if (comingSoon || janitor.comingSoon) return false;
    if (janitor.configKey && janitorConfig) {
      return janitorConfig[janitor.configKey] || false;
    }
    return false;
  };

  const isJanitorRunning = (janitor: JanitorItem): boolean => {
    return runningJanitors.has(janitor.id);
  };

  const handleToggle = async (janitor: JanitorItem) => {

    if (workspace?.poolState !== "COMPLETE") {
      open("ServicesWizard");
      return;
    }

    if (comingSoon || janitor.comingSoon || !janitor.configKey || !workspace?.slug) return;

    try {
      await toggleJanitor(workspace.slug, janitor.configKey);
    } catch (_error) {
      toast.error("Failed to update janitor configuration", { description: "Please try again." });
    }
  };

  const handleManualRun = async (janitor: JanitorItem) => {
    if (comingSoon || janitor.comingSoon || !workspace?.slug) return;

    try {
      await runJanitor(workspace.slug, janitor.id);
      toast("Janitor run started!", { description: "The janitor is now analyzing your codebase." });
    } catch (error) {
      toast.error("Failed to start janitor run", { description: error instanceof Error ? error.message : "Please try again." });
    }
  };

  return (
    <Card data-testid={`janitor-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
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
            const isItemComingSoon = janitor.comingSoon || comingSoon;

            return (
              <div
                key={janitor.id}
                data-testid={`janitor-item-${janitor.id}`}
                className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors ${isItemComingSoon ? 'opacity-60' : ''
                  }`}
              >
                <div className="flex items-center space-x-3 flex-1">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${isOn
                    ? 'bg-green-50 border-green-200'
                    : 'bg-background border-gray-200'
                    }`}>
                    <Icon className={`h-4 w-4 ${isOn
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                      }`} />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-medium text-sm" data-testid={`janitor-name-${janitor.id}`}>{janitor.name}</span>
                      {getStatusBadge(isOn, janitor.comingSoon || false, comingSoon || false)}
                    </div>
                    <p className="text-xs text-muted-foreground">{janitor.description}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {isItemComingSoon ? (
                    <Clock className="h-4 w-4 text-gray-400" />
                  ) : (
                    isOn && canManuallyRun(janitor.id) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-testid={`janitor-run-button-${janitor.id}`}
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
                    data-testid={`janitor-toggle-${janitor.id}`}
                    checked={isItemComingSoon ? false : isOn}
                    onCheckedChange={() => handleToggle(janitor)}
                    className="data-[state=checked]:bg-green-500"
                    disabled={isItemComingSoon || loading}
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
