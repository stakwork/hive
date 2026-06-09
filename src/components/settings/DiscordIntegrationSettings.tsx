"use client";

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, RefreshCw, Settings } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DiscordSetupWizard } from "./DiscordSetupWizard";

interface DiscordSettings {
  discordEnabled: boolean;
  discordClientId: string | null;
  hasToken: boolean;
}

interface DiscordChannelRecord {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  channelType: number;
  enabled: boolean;
  status: "ACTIVE" | "ERRORED" | "DISABLED_BY_SYSTEM";
  consecutiveFailures: number;
  lastMessageId: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
}

function channelIcon(type: number): string {
  if (type === 11 || type === 12) return "💬";
  if (type === 15) return "📌";
  return "#";
}

function StatusBadge({ status }: { status: DiscordChannelRecord["status"] }) {
  if (status === "ACTIVE") return <Badge className="bg-green-500/20 text-green-700 border-green-500/30">Active</Badge>;
  if (status === "ERRORED") return <Badge className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30">Errored</Badge>;
  return <Badge className="bg-red-500/20 text-red-700 border-red-500/30">Disabled</Badge>;
}

export function DiscordIntegrationSettings() {
  const { workspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const [settings, setSettings] = useState<DiscordSettings | null>(null);
  const [channels, setChannels] = useState<DiscordChannelRecord[]>([]);
  const [reenablingChannel, setReenablingChannel] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!workspace?.slug) return;
    setIsLoading(true);
    try {
      const [settingsRes, channelsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspace.slug}/settings/discord-integration`),
        fetch(`/api/workspaces/${workspace.slug}/settings/discord-channels`),
      ]);

      if (settingsRes.ok) {
        setSettings(await settingsRes.json());
      }
      if (channelsRes.ok) {
        const data = await channelsRes.json();
        setChannels(data.channels ?? []);
      }
    } catch {
      toast.error("Failed to load Discord settings");
    } finally {
      setIsLoading(false);
    }
  }, [workspace?.slug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleEnabled = async (value: boolean) => {
    if (!workspace?.slug || !settings) return;
    setIsTogglingEnabled(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.slug}/settings/discord-integration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordEnabled: value }),
      });
      if (res.ok) {
        setSettings((prev) => prev ? { ...prev, discordEnabled: value } : prev);
        toast.success(value ? "Discord integration enabled" : "Discord integration disabled");
      } else {
        toast.error("Failed to update setting");
      }
    } catch {
      toast.error("Failed to update setting");
    } finally {
      setIsTogglingEnabled(false);
    }
  };

  const handleSyncNow = async () => {
    if (!workspace?.slug) return;
    setIsSyncing(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.slug}/settings/discord-integration/sync`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Sync dispatched for ${data.dispatched} channel(s)`);
        setTimeout(fetchData, 2000);
      } else {
        toast.error("Failed to trigger sync");
      }
    } catch {
      toast.error("Failed to trigger sync");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReenableChannel = async (channel: DiscordChannelRecord) => {
    if (!workspace?.slug) return;
    setReenablingChannel(channel.id);
    try {
      // Re-submit all current channels plus re-enable the target channel
      const updatedChannels = channels.map((ch) =>
        ch.id === channel.id ? { ...ch, enabled: true } : ch
      );
      const res = await fetch(`/api/workspaces/${workspace.slug}/settings/discord-channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: updatedChannels.map((ch) => ({
            guildId: ch.guildId,
            guildName: ch.guildName,
            channelId: ch.channelId,
            channelName: ch.channelName,
            channelType: ch.channelType,
          })),
        }),
      });
      if (res.ok) {
        toast.success(`#${channel.channelName} re-enabled`);
        fetchData();
      } else {
        toast.error("Failed to re-enable channel");
      }
    } catch {
      toast.error("Failed to re-enable channel");
    } finally {
      setReenablingChannel(null);
    }
  };

  const handleWizardComplete = () => {
    setWizardOpen(false);
    fetchData();
  };

  if (!canAdmin) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discord Integration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Discord Integration</CardTitle>
          <CardDescription>
            Import Discord channel messages into your workspace knowledge graph. Messages become
            Communication nodes that AI can query alongside code and task data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="discord-enabled">Enable Discord sync</Label>
            <Switch
              id="discord-enabled"
              checked={settings?.discordEnabled ?? false}
              onCheckedChange={handleToggleEnabled}
              disabled={isTogglingEnabled || !settings?.hasToken}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncNow}
              disabled={isSyncing || !settings?.discordEnabled || channels.length === 0}
            >
              {isSyncing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing…</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" />Sync Now</>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWizardOpen(true)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure
            </Button>
          </div>

          {/* Channel list */}
          {channels.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No channels configured yet. Click <strong>Configure</strong> to set up the Discord
              integration and select channels to monitor.
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Synced Channels</p>
              <div className="rounded-md border divide-y">
                {channels.map((ch) => (
                  <div key={ch.id} className="flex items-start justify-between gap-3 px-3 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">
                          {channelIcon(ch.channelType)}{ch.channelName}
                        </span>
                        <StatusBadge status={ch.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {ch.guildName}
                        {ch.lastSyncedAt && (
                          <> · Last synced{" "}
                            {formatDistanceToNow(new Date(ch.lastSyncedAt), { addSuffix: true })}
                          </>
                        )}
                        {!ch.lastSyncedAt && " · Never synced"}
                      </p>
                      {(ch.status === "ERRORED" || ch.status === "DISABLED_BY_SYSTEM") && ch.syncError && (
                        <p className="text-xs text-destructive mt-1">{ch.syncError}</p>
                      )}
                    </div>
                    {ch.status === "DISABLED_BY_SYSTEM" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-xs h-7"
                        disabled={reenablingChannel === ch.id}
                        onClick={() => handleReenableChannel(ch)}
                      >
                        {reenablingChannel === ch.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Re-enable"
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <DiscordSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={handleWizardComplete}
      />
    </>
  );
}
