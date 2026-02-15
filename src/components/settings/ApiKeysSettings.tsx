"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import {
  Copy,
  Key,
  Loader2,
  Check,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import type { ApiKeyListItem, CreateApiKeyResponse } from "@/lib/schemas/api-keys";

export function ApiKeysSettings() {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKeyListItem[]>([]);

  // Create dialog state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiresAt, setNewKeyExpiresAt] = useState("");

  // New key display state
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreateApiKeyResponse | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Revoke state
  const [isRevoking, setIsRevoking] = useState<string | null>(null);

  // Fetch API keys on mount
  const fetchApiKeys = useCallback(async () => {
    if (!workspace?.slug) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/api-keys`);

      if (!response.ok) {
        if (response.status === 403) {
          // User doesn't have access, silently handle
          return;
        }
        throw new Error("Failed to fetch API keys");
      }

      const data = await response.json();
      setApiKeys(data.keys);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      toast.error("Failed to load API keys");
    } finally {
      setIsLoading(false);
    }
  }, [workspace?.slug]);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const handleCreateKey = useCallback(async () => {
    if (!workspace?.slug || !newKeyName.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
          expiresAt: newKeyExpiresAt || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create API key");
      }

      const data: CreateApiKeyResponse = await response.json();
      setNewlyCreatedKey(data);

      // Refresh the list
      await fetchApiKeys();

      toast.success("API key created successfully");
    } catch (error) {
      console.error("Error creating API key:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create API key");
    } finally {
      setIsCreating(false);
    }
  }, [workspace?.slug, newKeyName, newKeyExpiresAt, fetchApiKeys]);

  const handleCopyKey = useCallback(async () => {
    if (!newlyCreatedKey?.key) return;

    try {
      await navigator.clipboard.writeText(newlyCreatedKey.key);
      setCopySuccess(true);
      toast.success("API key copied to clipboard");
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Failed to copy API key");
    }
  }, [newlyCreatedKey]);

  const handleCloseCreateDialog = useCallback(() => {
    setIsCreateDialogOpen(false);
    setNewKeyName("");
    setNewKeyExpiresAt("");
    setNewlyCreatedKey(null);
    setCopySuccess(false);
  }, []);

  const handleRevokeKey = useCallback(
    async (keyId: string) => {
      if (!workspace?.slug) return;

      setIsRevoking(keyId);
      try {
        const response = await fetch(
          `/api/workspaces/${workspace.slug}/api-keys/${keyId}`,
          {
            method: "DELETE",
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to revoke API key");
        }

        // Refresh the list
        await fetchApiKeys();

        toast.success("API key revoked");
      } catch (error) {
        console.error("Error revoking API key:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to revoke API key"
        );
      } finally {
        setIsRevoking(null);
      }
    },
    [workspace?.slug, fetchApiKeys]
  );

  if (!workspace) return null;

  // Only show to users with write access (DEVELOPER+)
  if (!canWrite) return null;

  // Filter out revoked keys for display (or show them differently)
  const activeKeys = apiKeys.filter((key) => !key.isRevoked);
  const revokedKeys = apiKeys.filter((key) => key.isRevoked);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle>API Keys</CardTitle>
          <CardDescription className="mt-1.5">
            Create MCP API keys to access this workspace.
          </CardDescription>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            {!newlyCreatedKey ? (
              <>
                <DialogHeader>
                  <DialogTitle>Create API Key</DialogTitle>
                  <DialogDescription>
                    Create a new MCP API key to access this workspace.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="key-name">Name</Label>
                    <Input
                      id="key-name"
                      placeholder="e.g., Cursor - Work laptop"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      A descriptive name to identify this key.
                    </p>
                  </div>
                  {/* <div className="space-y-2">
                    <Label htmlFor="key-expires">Expiration (optional)</Label>
                    <Input
                      id="key-expires"
                      type="datetime-local"
                      value={newKeyExpiresAt}
                      onChange={(e) => setNewKeyExpiresAt(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Leave blank for no expiration.
                    </p>
                  </div> */}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={handleCloseCreateDialog}
                    disabled={isCreating}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateKey}
                    disabled={isCreating || !newKeyName.trim()}
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Key"
                    )}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>API Key Created</DialogTitle>
                  <DialogDescription>
                    Copy your API key now. You won&apos;t be able to see it again!
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      This key will only be shown once. Copy it now and store it
                      securely.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Your API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={newlyCreatedKey.key}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleCopyKey}
                      >
                        {copySuccess ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <h4 className="font-medium mb-2">Using with MCP</h4>
                    <p className="text-sm text-muted-foreground mb-2">
                      Add this to your MCP client configuration:
                    </p>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                      {JSON.stringify(
                        {
                          mcpServers: {
                            hive: {
                              url: `${typeof window !== "undefined" ? window.location.origin : ""}/api/mcp/mcp?apiKey=${newlyCreatedKey.key}`,
                            },
                          },
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCloseCreateDialog}>Done</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : activeKeys.length === 0 && revokedKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Key className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              No API keys yet. Create one to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {activeKeys.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell>
                        <code className="text-sm bg-muted px-2 py-1 rounded">
                          {key.keyPrefix}...
                        </code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDistanceToNow(new Date(key.createdAt), {
                          addSuffix: true,
                        })}
                        <div className="text-xs">
                          by {key.createdBy.name || "Unknown"}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {key.lastUsedAt
                          ? formatDistanceToNow(new Date(key.lastUsedAt), {
                              addSuffix: true,
                            })
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {key.expiresAt
                          ? format(new Date(key.expiresAt), "MMM d, yyyy")
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              disabled={isRevoking === key.id}
                            >
                              {isRevoking === key.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to revoke &quot;{key.name}
                                &quot;? Any applications using this key will
                                immediately lose access.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRevokeKey(key.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Revoke
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {revokedKeys.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Revoked Keys
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Revoked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revokedKeys.map((key) => (
                      <TableRow key={key.id} className="opacity-60">
                        <TableCell className="font-medium">{key.name}</TableCell>
                        <TableCell>
                          <code className="text-sm bg-muted px-2 py-1 rounded">
                            {key.keyPrefix}...
                          </code>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDistanceToNow(new Date(key.createdAt), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {key.revokedAt
                            ? formatDistanceToNow(new Date(key.revokedAt), {
                                addSuffix: true,
                              })
                            : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
