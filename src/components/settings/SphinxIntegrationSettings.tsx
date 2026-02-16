"use client";

import { useState, useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface SphinxSettings {
  sphinxEnabled: boolean;
  sphinxChatPubkey: string;
  sphinxBotId: string;
  hasBotSecret: boolean; // Don't return actual secret, just whether it exists
}

export function SphinxIntegrationSettings() {
  const { workspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [chatPubkey, setChatPubkey] = useState("");
  const [botId, setBotId] = useState("");
  const [botSecret, setBotSecret] = useState("");

  const [original, setOriginal] = useState<SphinxSettings | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      if (!workspace?.slug) return;

      try {
        const response = await fetch(`/api/workspaces/${workspace.slug}/settings/sphinx-integration`);
        if (response.ok) {
          const data: SphinxSettings = await response.json();
          setEnabled(data.sphinxEnabled);
          setChatPubkey(data.sphinxChatPubkey || "");
          setBotId(data.sphinxBotId || "");
          setOriginal(data);
        }
      } catch (error) {
        console.error("Failed to fetch Sphinx settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [workspace?.slug]);

  const hasChanges =
    enabled !== original?.sphinxEnabled ||
    chatPubkey !== (original?.sphinxChatPubkey || "") ||
    botId !== (original?.sphinxBotId || "") ||
    botSecret !== ""; // Any new secret counts as a change

  const handleSave = async () => {
    if (!workspace?.slug) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/settings/sphinx-integration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sphinxEnabled: enabled,
          sphinxChatPubkey: chatPubkey || null,
          sphinxBotId: botId || null,
          sphinxBotSecret: botSecret || undefined, // Only send if changed
        }),
      });

      if (response.ok) {
        toast.success("Sphinx settings saved");
        setBotSecret(""); // Clear after save
        setOriginal({
          sphinxEnabled: enabled,
          sphinxChatPubkey: chatPubkey,
          sphinxBotId: botId,
          hasBotSecret: !!botSecret || original?.hasBotSecret || false,
        });
      } else {
        const error = await response.json();
        toast.error(error.message || "Failed to save settings");
      }
    } catch (_error) {
      toast.error("Failed to save settings");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTest = async () => {
    if (!workspace?.slug) return;

    setIsTesting(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/sphinx/test`, {
        method: "POST",
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success("Test message sent to Sphinx!");
      } else {
        toast.error(result.error || "Failed to send test message");
      }
    } catch (_error) {
      toast.error("Failed to send test message");
    } finally {
      setIsTesting(false);
    }
  };

  if (!canAdmin) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sphinx Integration</CardTitle>
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
    <Card>
      <CardHeader>
        <CardTitle>Sphinx Integration</CardTitle>
        <CardDescription>
          Send daily PR summaries to a Sphinx tribe chat. Configure your bot credentials below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="sphinx-enabled">Enable Sphinx notifications</Label>
          <Switch
            id="sphinx-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="chat-pubkey">Chat Public Key</Label>
          <Input
            id="chat-pubkey"
            value={chatPubkey}
            onChange={(e) => setChatPubkey(e.target.value)}
            placeholder="027f3516ddb207..."
            disabled={!enabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bot-id">Bot ID</Label>
          <Input
            id="bot-id"
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
            placeholder="your_bot_id"
            disabled={!enabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bot-secret">
            Bot Secret {original?.hasBotSecret && "(configured)"}
          </Label>
          <Input
            id="bot-secret"
            type="password"
            value={botSecret}
            onChange={(e) => setBotSecret(e.target.value)}
            placeholder={original?.hasBotSecret ? "Enter new secret to change" : "your_bot_secret"}
            disabled={!enabled}
          />
        </div>

        <div className="rounded-lg border bg-muted/50 p-4">
          <h4 className="font-medium mb-2">Setup Instructions</h4>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Create a Sphinx bot and obtain your bot credentials</li>
            <li>Enter the chat public key, bot ID, and bot secret above</li>
            <li>Enable Sphinx notifications and save settings</li>
            <li>Use the test button to verify the integration works</li>
            <li>Daily PR summaries will be sent automatically at 1:00 AM UTC</li>
          </ol>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!enabled || !original?.hasBotSecret || isTesting}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send Test Message"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
