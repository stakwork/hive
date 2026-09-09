"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Pencil, Plug, Plus, Trash2, X } from "lucide-react";
import type { SerializedMcpServer } from "@/lib/mcp/orgMcpServerConfig";

interface McpServersSettingsProps {
  githubLogin: string;
}

interface HeaderRow {
  key: string;
  value: string;
}

interface DiscoveredTool {
  name: string;
  description: string | null;
}

interface FormState {
  /** null = creating a new server. */
  serverId: string | null;
  name: string;
  url: string;
  headerRows: HeaderRow[];
  /** True once the user edits any header row — only then are headers sent. */
  headersTouched: boolean;
  /** Existing header key names (edit mode), display-only. */
  existingHeaderKeys: string[];
  /** Selected tool names; empty = allow all tools. */
  toolFilter: string[];
}

const EMPTY_FORM: FormState = {
  serverId: null,
  name: "",
  url: "",
  headerRows: [],
  headersTouched: false,
  existingHeaderKeys: [],
  toolFilter: [],
};

function headersFromRows(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) out[key] = row.value;
  }
  return out;
}

/**
 * Admin card for the org's external MCP servers — the HTTP servers the
 * org canvas agent (Jamie) connects to at run start. Header values are
 * write-only: the API returns key names only, and the edit form sends
 * headers only when the user actually changes them.
 */
export function McpServersSettings({ githubLogin }: McpServersSettingsProps) {
  const [servers, setServers] = useState<SerializedMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [discoveredTools, setDiscoveredTools] = useState<DiscoveredTool[] | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SerializedMcpServer | null>(null);

  const baseUrl = `/api/orgs/${githubLogin}/mcp-servers`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(baseUrl);
      if (res.status === 404) {
        // resolveAuthorizedOrgId returns a unified 404 for non-admins.
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setServers(data.servers ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load MCP servers");
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setSaveError(null);
    setTestError(null);
    setDiscoveredTools(null);
    setDialogOpen(true);
  };

  const openEdit = (server: SerializedMcpServer) => {
    setForm({
      serverId: server.id,
      name: server.name,
      url: server.url,
      headerRows: [],
      headersTouched: false,
      existingHeaderKeys: server.headerKeys,
      toolFilter: server.toolFilter,
    });
    setSaveError(null);
    setTestError(null);
    setDiscoveredTools(null);
    setDialogOpen(true);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestError(null);
    setDiscoveredTools(null);
    try {
      const body: Record<string, unknown> = { url: form.url.trim() };
      if (form.serverId) body.serverId = form.serverId;
      // Only send headers the user typed — otherwise the saved server's
      // stored headers are reused server-side (edit mode).
      if (form.headersTouched) body.headers = headersFromRows(form.headerRows);
      const res = await fetch(`${baseUrl}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTestError(data.error ?? `Connection failed (${res.status})`);
        return;
      }
      setDiscoveredTools(data.tools ?? []);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        url: form.url.trim(),
        toolFilter: form.toolFilter,
      };
      if (form.headersTouched) {
        const headers = headersFromRows(form.headerRows);
        // Cleared every row → explicit null clears stored headers on PATCH.
        body.headers = Object.keys(headers).length > 0 ? headers : form.serverId ? null : undefined;
      }
      const res = await fetch(form.serverId ? `${baseUrl}/${form.serverId}` : baseUrl, {
        method: form.serverId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? `Save failed (${res.status})`);
        return;
      }
      setDialogOpen(false);
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (server: SerializedMcpServer, enabled: boolean) => {
    // Optimistic; revert on failure.
    setServers((prev) => prev.map((s) => (s.id === server.id ? { ...s, enabled } : s)));
    const res = await fetch(`${baseUrl}/${server.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      setServers((prev) => prev.map((s) => (s.id === server.id ? { ...s, enabled: server.enabled } : s)));
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    await fetch(`${baseUrl}/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    await refresh();
  };

  const toggleTool = (name: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      toolFilter: checked ? [...prev.toolFilter, name] : prev.toolFilter.filter((t) => t !== name),
    }));
  };

  const setHeaderRow = (index: number, patch: Partial<HeaderRow>) => {
    setForm((prev) => ({
      ...prev,
      headersTouched: true,
      headerRows: prev.headerRows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  if (forbidden) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP Servers</CardTitle>
          <CardDescription>Only workspace owners and admins can manage the org&apos;s MCP servers.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card data-testid="mcp-servers-settings">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Plug className="h-4 w-4" />
                MCP Servers
              </CardTitle>
              <CardDescription className="mt-1.5">
                External MCP servers the org chat agent connects to. Their tools are merged into the agent&apos;s
                toolset on every turn, prefixed with the server name.
              </CardDescription>
            </div>
            <Button size="sm" onClick={openCreate} data-testid="mcp-add-server">
              <Plus className="h-4 w-4 mr-1" />
              Add server
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive py-2">{loadError}</p>
          ) : servers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No MCP servers yet. Add one to give the agent extra tools.
            </p>
          ) : (
            <ul className="divide-y">
              {servers.map((server) => (
                <li key={server.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{server.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {server.toolFilter.length === 0
                          ? "all tools"
                          : `${server.toolFilter.length} tool${server.toolFilter.length === 1 ? "" : "s"}`}
                      </Badge>
                      {server.headerKeys.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          auth
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{server.url}</p>
                  </div>
                  <Switch
                    checked={server.enabled}
                    onCheckedChange={(v) => toggleEnabled(server, v)}
                    aria-label={`${server.name} enabled`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(server)}
                    aria-label={`Edit ${server.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(server)}
                    aria-label={`Delete ${server.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.serverId ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
            <DialogDescription>
              HTTP MCP endpoint the agent connects to. Header values are stored encrypted and never shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                placeholder="linear"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Prefixes the server&apos;s tool names (e.g. <code>linear_create_issue</code>). Letters, digits,{" "}
                <code>-</code>, <code>_</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mcp-url">URL</Label>
              <Input
                id="mcp-url"
                placeholder="https://mcp.example.com/mcp"
                value={form.url}
                onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Headers</Label>
              {form.existingHeaderKeys.length > 0 && !form.headersTouched && (
                <p className="text-xs text-muted-foreground">
                  Saved headers: {form.existingHeaderKeys.join(", ")} — adding rows below replaces them.
                </p>
              )}
              {form.headerRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="Authorization"
                    value={row.key}
                    onChange={(e) => setHeaderRow(i, { key: e.target.value })}
                    className="flex-1"
                  />
                  <Input
                    placeholder="Bearer …"
                    type="password"
                    value={row.value}
                    onChange={(e) => setHeaderRow(i, { value: e.target.value })}
                    className="flex-[2]"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove header"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        headersTouched: true,
                        headerRows: p.headerRows.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    headersTouched: true,
                    headerRows: [...p.headerRows, { key: "", value: "" }],
                  }))
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add header
              </Button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Tools</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testConnection}
                  disabled={testing || !form.url.trim()}
                  data-testid="mcp-test-connection"
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Plug className="h-3.5 w-3.5 mr-1" />
                  )}
                  Test connection
                </Button>
              </div>
              {testError && <p className="text-xs text-destructive">{testError}</p>}
              {discoveredTools ? (
                discoveredTools.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Connected — the server exposes no tools.</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                    {discoveredTools.map((tool) => (
                      <label key={tool.name} className="flex items-start gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={form.toolFilter.length === 0 || form.toolFilter.includes(tool.name)}
                          onCheckedChange={(v) => {
                            // First uncheck from "all" state → select everything else.
                            if (form.toolFilter.length === 0) {
                              setForm((p) => ({
                                ...p,
                                toolFilter: discoveredTools.map((t) => t.name).filter((n) => n !== tool.name),
                              }));
                            } else {
                              toggleTool(tool.name, v === true);
                            }
                          }}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{tool.name}</span>
                          {tool.description && (
                            <span className="block text-xs text-muted-foreground truncate">{tool.description}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )
              ) : form.toolFilter.length > 0 ? (
                <p className="text-xs text-muted-foreground">Allowed: {form.toolFilter.join(", ")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  All tools allowed. Test the connection to pick specific ones.
                </p>
              )}
            </div>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving || !form.name.trim() || !form.url.trim()}
              data-testid="mcp-save-server"
            >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {form.serverId ? "Save changes" : "Add server"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete MCP server?"
        description={`The agent will lose access to "${deleteTarget?.name}" tools. This cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        onConfirm={remove}
      />
    </>
  );
}
