import { useModal } from "@/components/modals/ModlaProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { WorkspaceRole } from "@/lib/auth/roles";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { JanitorType } from "@prisma/client";
import { Clock, Loader2, Lock, LucideIcon, Play } from "lucide-react";
import { ReactNode, useEffect } from "react";

export interface JanitorItem {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  configKey?: string;
  comingSoon?: boolean;
  childOptions?: JanitorItem[]; // Child options that depend on this parent being enabled
  parentKey?: string; // Reference to parent configKey (for child options)
  exclusiveGroup?: string; // For mutually exclusive options (radio-button behavior)
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
  const { permissions, checkPermission } = useWorkspaceAccess();
  const open = useModal();

  // Check if user has PM role or higher to manage janitors
  const canManageJanitors = checkPermission(WorkspaceRole.PM);

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

  const handleToggle = async (janitor: JanitorItem, parentJanitor?: JanitorItem) => {
    // Check permissions first
    if (!canManageJanitors) {
      toast.error("Permission denied", { 
        description: "You need Admin or Owner permissions to manage janitor settings." 
      });
      return;
    }

    if (workspace?.poolState !== "COMPLETE") {
      open("ServicesWizard");
      return;
    }

    if (comingSoon || janitor.comingSoon || !janitor.configKey || !workspace?.slug) return;

    // Handle mutually exclusive options (radio-button behavior)
    if (janitor.exclusiveGroup && parentJanitor?.childOptions) {
      const isCurrentlyOn = getJanitorState(janitor);
      
      // If turning on this option, turn off all others in the same exclusive group
      if (!isCurrentlyOn) {
        const siblingsToDisable = parentJanitor.childOptions.filter(
          (child) => child.exclusiveGroup === janitor.exclusiveGroup && child.configKey !== janitor.configKey
        );

        try {
          // Turn off all siblings first
          for (const sibling of siblingsToDisable) {
            if (sibling.configKey && getJanitorState(sibling)) {
              await toggleJanitor(workspace.slug, sibling.configKey);
            }
          }
          // Then turn on the selected option
          await toggleJanitor(workspace.slug, janitor.configKey);
        } catch {
          toast.error("Failed to update janitor configuration", { description: "Please try again." });
        }
        return;
      }
      // Don't allow turning off a radio button option (at least one must be selected)
      return;
    }

    // Normal toggle behavior
    try {
      await toggleJanitor(workspace.slug, janitor.configKey);
    } catch {
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
              <div key={janitor.id}>
                <div
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
                      <>
                        {isOn && canManuallyRun(janitor.id) && (
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
                        )}
                        {!canManageJanitors && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Lock className="h-4 w-4 text-muted-foreground" data-testid={`janitor-lock-${janitor.id}`} />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>PM role or higher required to manage janitors</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </>
                    )}
                    <Switch
                      data-testid={`janitor-toggle-${janitor.id}`}
                      checked={isItemComingSoon ? false : isOn}
                      onCheckedChange={() => handleToggle(janitor)}
                      className="data-[state=checked]:bg-green-500"
                      disabled={isItemComingSoon || loading || !canManageJanitors}
                    />
                  </div>
                </div>

                {/* Render child options if parent is enabled */}
                {isOn && janitor.childOptions && janitor.childOptions.length > 0 && (
                  <div className="ml-11 mt-2 space-y-2">
                    {janitor.childOptions.map((childOption) => {
                      const ChildIcon = childOption.icon;
                      const isChildOn = getJanitorState(childOption);
                      const isChildComingSoon = childOption.comingSoon || comingSoon;

                      return (
                        <div
                          key={childOption.id}
                          data-testid={`janitor-item-${childOption.id}`}
                          className={`flex items-center justify-between p-2 rounded-lg border border-dashed bg-card/50 hover:bg-accent/30 transition-colors ${isChildComingSoon ? 'opacity-60' : ''
                            }`}
                        >
                          <div className="flex items-center space-x-3 flex-1">
                            <div className={`flex items-center justify-center w-6 h-6 rounded-full border ${isChildOn
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-background border-gray-200'
                              }`}>
                              <ChildIcon className={`h-3 w-3 ${isChildOn
                                ? 'text-blue-600'
                                : 'text-muted-foreground'
                                }`} />
                            </div>

                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                <span className="font-medium text-xs" data-testid={`janitor-name-${childOption.id}`}>{childOption.name}</span>
                                {isChildOn && <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">Strategy</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">{childOption.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            {!canManageJanitors && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Lock className="h-3 w-3 text-muted-foreground" data-testid={`janitor-lock-${childOption.id}`} />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>PM role or higher required to manage janitors</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <Switch
                              data-testid={`janitor-toggle-${childOption.id}`}
                              checked={isChildComingSoon ? false : isChildOn}
                              onCheckedChange={() => handleToggle(childOption, janitor)}
                              className="data-[state=checked]:bg-blue-500"
                              disabled={isChildComingSoon || loading || !canManageJanitors}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
