"use client";

import React, { useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, AlertTriangle, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";

interface WizardChannel {
  id: string;
  name: string;
  type: number;
}

interface WizardGuild {
  id: string;
  name: string;
  channels: WizardChannel[];
}

interface DiscordSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

function channelIcon(type: number): string {
  if (type === 11 || type === 12) return "💬";
  if (type === 15) return "📌";
  return "#";
}

export function DiscordSetupWizard({ open, onOpenChange, onComplete }: DiscordSetupWizardProps) {
  const { workspace } = useWorkspace();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 state
  const [token, setToken] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenValidated, setTokenValidated] = useState(false);
  const [wizardClientId, setWizardClientId] = useState<string | null>(null);

  // Step 3 state
  const [manualClientId, setManualClientId] = useState("");
  const [isCheckingGuilds, setIsCheckingGuilds] = useState(false);
  const [guildError, setGuildError] = useState<string | null>(null);
  const [guilds, setGuilds] = useState<WizardGuild[]>([]);

  // Step 4 state
  const [expandedGuilds, setExpandedGuilds] = useState<Set<string>>(new Set());
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const slug = workspace?.slug;

  // ─── Step 1 ───────────────────────────────────────────────────────────────

  const handleVerifyToken = async () => {
    if (!slug || !token.trim()) return;
    setIsValidating(true);
    setTokenError(null);
    try {
      const res = await fetch(`/api/workspaces/${slug}/settings/discord-integration/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.valid) {
        setWizardClientId(data.clientId ?? null);
        // Save token to workspace
        await fetch(`/api/workspaces/${slug}/settings/discord-integration`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discordEnabled: false, discordBotToken: token }),
        });
        setTokenValidated(true);
      } else {
        setTokenError(data.error ?? "Invalid token — check the Developer Portal");
      }
    } catch {
      setTokenError("Failed to validate token. Please try again.");
    } finally {
      setIsValidating(false);
    }
  };

  // ─── Step 3 ───────────────────────────────────────────────────────────────

  const effectiveClientId = wizardClientId ?? (manualClientId.trim() || null);

  const handleInviteBot = () => {
    if (!effectiveClientId) return;
    const params = new URLSearchParams({
      client_id: effectiveClientId,
      permissions: "66560",
      scope: "bot",
    });
    window.open(`https://discord.com/oauth2/authorize?${params}`, "_blank");
  };

  const handleCheckGuilds = async () => {
    if (!slug) return;
    setIsCheckingGuilds(true);
    setGuildError(null);
    try {
      const res = await fetch(`/api/workspaces/${slug}/settings/discord-integration/guilds`);
      const data = await res.json();
      if (!res.ok) {
        setGuildError(data.error ?? "Failed to fetch guilds");
        return;
      }
      if (!data.guilds || data.guilds.length === 0) {
        setGuildError("Bot not found in any server — make sure you clicked the invite link and authorized it");
        return;
      }
      setGuilds(data.guilds);
      // Expand all guilds by default
      setExpandedGuilds(new Set(data.guilds.map((g: WizardGuild) => g.id)));
      setStep(4);
    } catch {
      setGuildError("Failed to check guilds. Please try again.");
    } finally {
      setIsCheckingGuilds(false);
    }
  };

  // ─── Step 4 ───────────────────────────────────────────────────────────────

  const toggleGuild = (guildId: string) => {
    setExpandedGuilds((prev) => {
      const next = new Set(prev);
      if (next.has(guildId)) next.delete(guildId);
      else next.add(guildId);
      return next;
    });
  };

  const toggleChannel = (channelId: string) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const handleSaveAndFinish = async () => {
    if (!slug || selectedChannels.size === 0) return;
    setIsSaving(true);
    try {
      const channelPayload = guilds.flatMap((guild) =>
        guild.channels
          .filter((ch) => selectedChannels.has(ch.id))
          .map((ch) => ({
            guildId: guild.id,
            guildName: guild.name,
            channelId: ch.id,
            channelName: ch.name,
            channelType: ch.type,
          }))
      );

      const putRes = await fetch(`/api/workspaces/${slug}/settings/discord-channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: channelPayload }),
      });

      if (!putRes.ok) throw new Error("Failed to save channels");

      // Enable the integration
      await fetch(`/api/workspaces/${slug}/settings/discord-integration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordEnabled: true }),
      });

      toast.success("Discord integration configured!");
      onComplete();
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Reset on close ───────────────────────────────────────────────────────

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setStep(1);
      setToken("");
      setTokenError(null);
      setTokenValidated(false);
      setWizardClientId(null);
      setManualClientId("");
      setGuildError(null);
      setGuilds([]);
      setSelectedChannels(new Set());
      setExpandedGuilds(new Set());
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Set Up Discord Integration</DialogTitle>
          <DialogDescription>Step {step} of 4</DialogDescription>
        </DialogHeader>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/50 p-4 text-sm space-y-2">
              <p className="font-medium">Create a Discord Bot</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>
                  Go to the{" "}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline inline-flex items-center gap-1"
                  >
                    Discord Developer Portal
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Create a new Application</li>
                <li>Navigate to the <strong>Bot</strong> tab and click <strong>Reset Token</strong></li>
                <li>Copy the token and paste it below</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bot-token">Bot Token</Label>
              <Input
                id="bot-token"
                type="password"
                placeholder="Bot Token"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setTokenError(null);
                  setTokenValidated(false);
                }}
              />
            </div>

            {tokenError && (
              <p className="text-sm text-destructive">{tokenError}</p>
            )}

            {tokenValidated && (
              <p className="text-sm text-green-600">✓ Token verified successfully</p>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleVerifyToken}
                  disabled={!token.trim() || isValidating}
                >
                  {isValidating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verifying…</>
                  ) : "Verify Token"}
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={!tokenValidated}
                >
                  Next →
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/50 p-4 text-sm space-y-2">
              <p className="font-medium">Enable MESSAGE_CONTENT Intent</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Go to Discord Developer Portal → Your Application → <strong>Bot</strong></li>
                <li>Scroll down to <strong>Privileged Gateway Intents</strong></li>
                <li>Enable <strong>Message Content Intent</strong> and click Save</li>
              </ol>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Without this intent enabled, imported messages will arrive empty.
              </AlertDescription>
            </Alert>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
              <Button onClick={() => setStep(3)}>Done, I&apos;ve enabled it →</Button>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Invite your bot to your Discord server so Hive can read its channels.
            </p>

            {wizardClientId === null && (
              <div className="space-y-2">
                <Label htmlFor="manual-client-id">
                  Application / Client ID{" "}
                  <span className="text-muted-foreground text-xs">(could not be extracted from token)</span>
                </Label>
                <Input
                  id="manual-client-id"
                  placeholder="e.g. 1234567890123456789"
                  value={manualClientId}
                  onChange={(e) => setManualClientId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Find this in the Developer Portal under <strong>General Information → Application ID</strong>.
                </p>
              </div>
            )}

            <Button
              variant="outline"
              onClick={handleInviteBot}
              disabled={!effectiveClientId}
              className="w-full"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Invite Bot to Server
            </Button>

            {guildError && (
              <p className="text-sm text-destructive">{guildError}</p>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>← Back</Button>
              <Button
                onClick={handleCheckGuilds}
                disabled={isCheckingGuilds}
              >
                {isCheckingGuilds ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Checking…</>
                ) : "My bot is in the server →"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4 ── */}
        {step === 4 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select the channels you want to import into the knowledge graph.
            </p>

            <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
              {guilds.map((guild) => (
                <div key={guild.id}>
                  <button
                    type="button"
                    onClick={() => toggleGuild(guild.id)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
                  >
                    {expandedGuilds.has(guild.id) ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    {guild.name}
                  </button>
                  {expandedGuilds.has(guild.id) && (
                    <div className="pl-8 pb-1 space-y-1 bg-muted/20">
                      {guild.channels.map((ch) => (
                        <label
                          key={ch.id}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 rounded"
                        >
                          <Checkbox
                            id={`ch-${ch.id}`}
                            checked={selectedChannels.has(ch.id)}
                            onCheckedChange={() => toggleChannel(ch.id)}
                          />
                          <span>
                            {channelIcon(ch.type)}
                            {ch.name}
                          </span>
                        </label>
                      ))}
                      {guild.channels.length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">No text channels found</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {selectedChannels.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedChannels.size} channel{selectedChannels.size !== 1 ? "s" : ""} selected
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}>← Back</Button>
              <Button
                onClick={handleSaveAndFinish}
                disabled={selectedChannels.size === 0 || isSaving}
              >
                {isSaving ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                ) : "Save & Finish"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
