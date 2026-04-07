"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExternalLink, Loader2, AlertCircle, RefreshCw, Zap, Plus } from "lucide-react";
import { toast } from "sonner";
import type { PaidEndpoint, BoltwallUser, GraphAdminClientProps } from "./types";
import { postGraphAdminCmd } from "./utils";
import { CopyButton, UserRow, UserFormDialog, SetOwnerDialog } from "./components";

export function GraphAdminClient({ swarmUrl, workspaceSlug }: GraphAdminClientProps) {
  const hostname = swarmUrl ? new URL(swarmUrl).hostname : null;

  // ── Graph/Endpoints state ──
  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  const [endpoints, setEndpoints] = useState<PaidEndpoint[] | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [endpointLoadingIds, setEndpointLoadingIds] = useState<Set<number>>(new Set());

  // ── Bot state ──
  const [botBalance, setBotBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [invoiceSats, setInvoiceSats] = useState("");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<{ invoice: string; qrCodeDataUrl: string } | null>(null);

  // ── Users state ──
  const [users, setUsers] = useState<BoltwallUser[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<BoltwallUser | undefined>(undefined);
  const [setOwnerOpen, setSetOwnerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BoltwallUser | null>(null);

  // ── Load graph/endpoints on mount ──
  useEffect(() => {
    if (!swarmUrl) {
      setInitialLoading(false);
      return;
    }

    let cancelled = false;
    async function loadInitialState() {
      try {
        const [visibilityRes, endpointsRes] = await Promise.allSettled([
          postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } }),
          postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "ListPaidEndpoint" } }),
        ]);
        if (cancelled) return;
        if (visibilityRes.status === "fulfilled") {
          setIsPublic(visibilityRes.value?.isPublic ?? false);
        } else {
          toast.error("Failed to load graph visibility");
        }
        if (endpointsRes.status === "fulfilled") {
          const res = endpointsRes.value;
          setEndpoints(res?.endpoints ?? (Array.isArray(res) ? res : []));
        } else {
          toast.error("Failed to load payment routes");
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }
    loadInitialState();
    return () => { cancelled = true; };
  }, [swarmUrl, workspaceSlug]);

  // ── Load bot balance on mount ──
  async function fetchBotBalance() {
    setBalanceLoading(true);
    try {
      const res = await postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "GetBotBalance" } });
      // Swarm returns msats; convert to sats
      const msats = typeof res === "number" ? res : (res?.balance ?? res?.msats ?? null);
      setBotBalance(msats !== null ? Math.floor(msats / 1000) : null);
    } catch {
      toast.error("Failed to load bot balance");
    } finally {
      setBalanceLoading(false);
    }
  }

  useEffect(() => {
    if (!swarmUrl) { setBalanceLoading(false); return; }
    fetchBotBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swarmUrl, workspaceSlug]);

  // ── Load enriched users ──
  async function fetchUsers() {
    setUsersLoading(true);
    try {
      const res = await postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "GetEnrichedBoltwallUsers" } });
      setUsers(res?.users ?? []);
    } catch {
      toast.error("Failed to load boltwall users");
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    if (!swarmUrl) { setUsersLoading(false); return; }
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swarmUrl, workspaceSlug]);

  // ── Graph visibility ──
  async function handleVisibilityToggle(newValue: boolean) {
    const previous = isPublic;
    setIsPublic(newValue);
    setVisibilityLoading(true);
    try {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "UpdateBoltwallAccessibility", content: newValue },
      });
      // Re-fetch to confirm actual swarm state
      const confirmed = await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "GetBoltwallAccessibility" },
      });
      setIsPublic(confirmed?.isPublic ?? newValue);
      toast.success("Graph visibility updated");
    } catch {
      setIsPublic(previous);
      toast.error("Failed to update visibility");
    } finally {
      setVisibilityLoading(false);
    }
  }

  // ── Endpoint toggle ──
  async function handleEndpointToggle(endpoint: PaidEndpoint) {
    const newStatus = !endpoint.status;
    setEndpoints((prev) =>
      prev ? prev.map((e) => (e.id === endpoint.id ? { ...e, status: newStatus } : e)) : prev,
    );
    setEndpointLoadingIds((prev) => new Set(prev).add(endpoint.id));
    try {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "UpdatePaidEndpoint", content: { id: endpoint.id, status: newStatus } },
      });
      // Re-fetch to confirm actual swarm state
      const confirmed = await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "ListPaidEndpoint" },
      });
      const refreshed = confirmed?.endpoints ?? (Array.isArray(confirmed) ? confirmed : null);
      if (refreshed) setEndpoints(refreshed);
      toast.success(`Payment route ${newStatus ? "enabled" : "disabled"}`);
    } catch {
      setEndpoints((prev) =>
        prev ? prev.map((e) => (e.id === endpoint.id ? { ...e, status: endpoint.status } : e)) : prev,
      );
      toast.error("Failed to update payment route");
    } finally {
      setEndpointLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(endpoint.id);
        return next;
      });
    }
  }

  // ── Bot: generate invoice ──
  async function handleGenerateInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceSats || invoiceLoading) return;
    setInvoiceLoading(true);
    setInvoiceResult(null);
    try {
      const res = await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "CreateBotInvoice", content: { amt_msat: parseInt(invoiceSats) * 1000 } },
      });
      const invoice = typeof res === "string" ? res : (res?.invoice ?? res?.payment_request ?? "");
      const qrCodeDataUrl = res?.qrCodeDataUrl ?? "";
      setInvoiceResult({ invoice, qrCodeDataUrl });
      toast.success("Invoice generated");
    } catch {
      toast.error("Failed to generate invoice");
    } finally {
      setInvoiceLoading(false);
    }
  }

  // ── Users: save (add/edit) ──
  async function handleSaveUser(data: { pubkey: string; name: string; role: string }) {
    if (editingUser) {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: {
          cmd: "UpdateUser",
          content: { id: editingUser.id!, pubkey: data.pubkey, name: data.name, role: data.role },
        },
      });
      toast.success("User updated");
    } else {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "AddBoltwallUser", content: { pubkey: data.pubkey, name: data.name, role: data.role } },
      });
      toast.success("User added");
    }
    setEditingUser(undefined);
    await fetchUsers();
  }

  // ── Users: set owner ──
  async function handleSetOwner(data: { pubkey: string; name: string }) {
    await postGraphAdminCmd(workspaceSlug, {
      type: "Swarm",
      data: { cmd: "AddBoltwallAdminPubkey", content: { pubkey: data.pubkey, name: data.name } },
    });
    toast.success("Owner set");
    await fetchUsers();
  }

  // ── Users: delete ──
  async function handleDeleteUser() {
    if (!deleteTarget?.pubkey) return;
    await postGraphAdminCmd(workspaceSlug, {
      type: "Swarm",
      data: { cmd: "DeleteSubAdmin", content: deleteTarget.pubkey },
    });
    toast.success("User removed");
    setDeleteTarget(null);
    await fetchUsers();
  }

  // ─── Derived ───
  const ownerUser = users?.find((u) => u.role === "owner") ?? null;
  const nonOwnerUsers = users?.filter((u) => u.role !== "owner") ?? [];

  // No swarm configured
  if (!swarmUrl) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">Graph swarm is not yet configured for this workspace.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Links</CardTitle>
          <CardDescription>Open the graph viewer or swarm dashboard in a new tab.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {hostname ? (
            <>
              <Button asChild variant="outline">
                <a href={`https://${hostname}:8000`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Graph Viewer
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`https://${hostname}:8800`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Swarm Dashboard
                </a>
              </Button>
            </>
          ) : (
            <>
              <Skeleton className="h-10 w-36" />
              <Skeleton className="h-10 w-36" />
            </>
          )}
        </CardContent>
      </Card>

      {/* Graph Visibility */}
      <Card>
        <CardHeader>
          <CardTitle>Graph Visibility</CardTitle>
          <CardDescription>Control whether your graph is publicly accessible.</CardDescription>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <div className="flex items-center gap-3">
              <Switch
                checked={isPublic ?? false}
                onCheckedChange={handleVisibilityToggle}
                disabled={visibilityLoading}
                aria-label="Toggle graph visibility"
              />
              {visibilityLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-sm font-medium">{isPublic ? "Public" : "Private"}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Routes */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Routes</CardTitle>
          <CardDescription>Enable or disable individual Lightning payment routes (boltwall).</CardDescription>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !endpoints || endpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment routes configured.</p>
          ) : (
            <ul className="divide-y">
              {endpoints.map((endpoint) => {
                const isLoading = endpointLoadingIds.has(endpoint.id);
                return (
                  <li key={endpoint.id} className="flex items-center justify-between py-3 gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="shrink-0 font-mono text-xs">
                        {endpoint.method}
                      </Badge>
                      <span className="text-sm truncate">/{endpoint.route}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">{endpoint.fee} sats</span>
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Switch
                          checked={endpoint.status}
                          onCheckedChange={() => handleEndpointToggle(endpoint)}
                          aria-label={`Toggle ${endpoint.route}`}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Bot */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Bot
          </CardTitle>
          <CardDescription>View the bot&apos;s Lightning wallet balance and create invoices.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Balance */}
          <div className="flex items-center gap-3">
            {balanceLoading ? (
              <Skeleton className="h-6 w-32" />
            ) : (
              <span className="text-sm font-medium">
                {botBalance !== null ? `${botBalance.toLocaleString()} sats` : "—"}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchBotBalance}
              disabled={balanceLoading}
              aria-label="Refresh balance"
            >
              <RefreshCw className={`h-4 w-4 ${balanceLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* Invoice form */}
          <form onSubmit={handleGenerateInvoice} className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invoice-sats">Amount (sats)</Label>
              <Input
                id="invoice-sats"
                type="number"
                min={1}
                placeholder="Amount in sats"
                value={invoiceSats}
                onChange={(e) => setInvoiceSats(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!invoiceSats || invoiceLoading}>
              {invoiceLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              Generate Invoice
            </Button>
          </form>

          {/* Invoice result */}
          {invoiceResult && (
            <div className="space-y-3 rounded-lg border p-4">
              {invoiceResult.qrCodeDataUrl && (
                <img
                  src={invoiceResult.qrCodeDataUrl}
                  alt="Lightning invoice QR"
                  className="w-48 h-48 mx-auto"
                />
              )}
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs truncate flex-1 text-muted-foreground">
                  {invoiceResult.invoice}
                </p>
                <CopyButton value={invoiceResult.invoice} label="Invoice" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Users */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Users</CardTitle>
            <CardDescription>Manage boltwall users and their access roles.</CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => { setEditingUser(undefined); setUserFormOpen(true); }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !users || users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No boltwall users found.</p>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Owner row first */}
                  {ownerUser !== null && (
                    <UserRow
                      user={ownerUser}
                      onEdit={() => { setEditingUser(ownerUser); setUserFormOpen(true); }}
                      onDelete={() => setDeleteTarget(ownerUser)}
                      onSetOwner={() => setSetOwnerOpen(true)}
                    />
                  )}
                  {nonOwnerUsers.map((u, i) => (
                    <UserRow
                      key={u.id ?? u.pubkey ?? i}
                      user={u}
                      onEdit={() => { setEditingUser(u); setUserFormOpen(true); }}
                      onDelete={() => setDeleteTarget(u)}
                      onSetOwner={() => setSetOwnerOpen(true)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <UserFormDialog
        open={userFormOpen}
        onOpenChange={(v) => { setUserFormOpen(v); if (!v) setEditingUser(undefined); }}
        user={editingUser}
        onSave={handleSaveUser}
      />
      <SetOwnerDialog
        open={setOwnerOpen}
        onOpenChange={setSetOwnerOpen}
        onSave={handleSetOwner}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Remove User"
        description={`Are you sure you want to remove ${deleteTarget?.name ?? deleteTarget?.pubkey?.slice(0, 16) ?? "this user"}? This action cannot be undone.`}
        confirmText="Remove"
        variant="destructive"
        onConfirm={handleDeleteUser}
      />
    </div>
  );
}
