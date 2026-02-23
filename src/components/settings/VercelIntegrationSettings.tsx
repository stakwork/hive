"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { ChevronRight, Copy, Eye, EyeOff, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

interface VercelIntegrationData {
  vercelWebhookSecret: string | null;
  webhookUrl: string;
  swarmLogDrainUrl: string | null;
  swarmBearerToken: string | null;
}

type Section = "agent" | "realtime";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  }, [value, label]);

  return (
    <Button type="button" variant="outline" size="icon" onClick={handleCopy} disabled={!value}>
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

export function VercelIntegrationSettings() {
  const { workspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [openSection, setOpenSection] = useState<Section | null>(null);

  // Form state
  const [vercelWebhookSecret, setVercelWebhookSecret] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [swarmLogDrainUrl, setSwarmLogDrainUrl] = useState<string | null>(null);
  const [swarmBearerToken, setSwarmBearerToken] = useState<string | null>(null);

  // Track original values to detect changes
  const [originalWebhookSecret, setOriginalWebhookSecret] = useState("");

  // Fetch current settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      if (!workspace?.slug) return;

      setIsLoading(true);
      try {
        const response = await fetch(`/api/workspaces/${workspace.slug}/settings/vercel-integration`);

        if (!response.ok) {
          if (response.status === 403) return;
          throw new Error("Failed to fetch Vercel integration settings");
        }

        const data: VercelIntegrationData = await response.json();

        setVercelWebhookSecret(data.vercelWebhookSecret || "");
        setWebhookUrl(data.webhookUrl || "");
        setSwarmLogDrainUrl(data.swarmLogDrainUrl);
        setSwarmBearerToken(data.swarmBearerToken);

        setOriginalWebhookSecret(data.vercelWebhookSecret || "");
      } catch (error) {
        console.error("Error fetching Vercel integration settings:", error);
        toast.error("Failed to load Vercel integration settings");
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [workspace?.slug]);

  const handleSave = useCallback(async () => {
    if (!workspace?.slug) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/settings/vercel-integration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vercelWebhookSecret: vercelWebhookSecret || null }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save settings");
      }

      setOriginalWebhookSecret(vercelWebhookSecret);
      toast.success("Vercel integration settings saved successfully");
    } catch (error) {
      console.error("Error saving Vercel integration settings:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setIsSubmitting(false);
    }
  }, [workspace?.slug, vercelWebhookSecret]);

  const hasChanges = vercelWebhookSecret !== originalWebhookSecret;

  const toggleSection = useCallback(
    (section: Section) => {
      setOpenSection((prev) => (prev === section ? null : section));
    },
    [],
  );

  if (!workspace) return null;
  if (!canAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vercel Integration</CardTitle>
        <CardDescription>Connect Vercel log drains for monitoring.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Agent Analysis Section */}
            <Collapsible open={openSection === "agent"} onOpenChange={() => toggleSection("agent")}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors">
                <ChevronRight
                  className={`h-4 w-4 shrink-0 transition-transform ${openSection === "agent" ? "rotate-90" : ""}`}
                />
                <div>
                  <p className="font-medium text-sm">Log Drain — Agent Analysis</p>
                  <p className="text-xs text-muted-foreground">AI-powered log analysis via your swarm.</p>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-3 pt-1 space-y-4">
                  {swarmLogDrainUrl && swarmBearerToken ? (
                    <>
                      {/* Endpoint URL */}
                      <div className="space-y-2">
                        <Label>Endpoint URL</Label>
                        <div className="flex gap-2">
                          <Input
                            type="text"
                            value={swarmLogDrainUrl}
                            readOnly
                            className="bg-muted font-mono text-sm"
                          />
                          <CopyButton value={swarmLogDrainUrl} label="Endpoint URL" />
                        </div>
                      </div>

                      {/* Setup Instructions */}
                      <div className="rounded-lg border bg-muted/50 p-4">
                        <h4 className="font-medium mb-2 text-sm">Setup</h4>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                          <li>Go to Vercel → Project Settings → Log Drains</li>
                          <li>Set the Endpoint URL above</li>
                          <li>Select <strong>NDJSON</strong> as Encoding</li>
                          <li>
                            Add Custom Header: <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer {swarmBearerToken}</code>
                          </li>
                        </ol>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No swarm configured. Set up a swarm to enable agent log analysis.
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Realtime Monitor Section */}
            <Collapsible open={openSection === "realtime"} onOpenChange={() => toggleSection("realtime")}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors">
                <ChevronRight
                  className={`h-4 w-4 shrink-0 transition-transform ${openSection === "realtime" ? "rotate-90" : ""}`}
                />
                <div>
                  <p className="font-medium text-sm">Log Drain — Realtime Monitor</p>
                  <p className="text-xs text-muted-foreground">Stream logs to the Hive dashboard.</p>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-3 pt-1 space-y-4">
                  {/* Webhook Secret */}
                  <div className="space-y-2">
                    <Label htmlFor="vercel-webhook-secret">Log Drain Webhook Secret</Label>
                    <div className="relative">
                      <Input
                        id="vercel-webhook-secret"
                        type={showWebhookSecret ? "text" : "password"}
                        value={vercelWebhookSecret}
                        onChange={(e) => setVercelWebhookSecret(e.target.value)}
                        placeholder="Enter a secret for webhook verification"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                        tabIndex={-1}
                      >
                        {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      A secret string used to verify webhook requests from Vercel. Use the same value when configuring
                      the log drain in Vercel.
                    </p>
                  </div>

                  {/* Webhook URL */}
                  <div className="space-y-2">
                    <Label htmlFor="webhook-url">Webhook URL</Label>
                    <div className="flex gap-2">
                      <Input
                        id="webhook-url"
                        type="text"
                        value={webhookUrl}
                        readOnly
                        className="bg-muted font-mono text-sm"
                      />
                      <CopyButton value={webhookUrl} label="Webhook URL" />
                    </div>
                  </div>

                  {/* Setup Instructions */}
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <h4 className="font-medium mb-2 text-sm">Setup</h4>
                    <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                      <li>Create a webhook secret (any random string) and enter it above</li>
                      <li>Save these settings, then copy the webhook URL</li>
                      <li>Go to your Vercel project settings → Log Drains</li>
                      <li>Add a new log drain with the webhook URL and the same secret</li>
                      <li>Select <strong>NDJSON</strong> format and the log sources you want to receive</li>
                    </ol>
                  </div>

                  {/* Save Button */}
                  <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={isSubmitting || !hasChanges}>
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  );
}
