"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ExternalLink,
  Loader2,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  Pencil,
  Trash2,
  Plus,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { SwarmCmd } from "@/services/swarm/cmd";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PaidEndpoint {
  id: number;
  route: string;
  method: string;
  status: boolean;
  fee: number;
}

interface BoltwallUser {
  id?: number;
  pubkey: string | null;
  name: string | null;
  role: "owner" | "admin" | "sub_admin" | "member";
  hive?: { name: string | null; image: string | null } | null;
}

interface GraphAdminClientProps {
  swarmUrl: string | null;
  workspaceSlug: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function postGraphAdminCmd(workspaceSlug: string, cmd: SwarmCmd) {
  const res = await fetch(`/api/workspaces/${workspaceSlug}/graph-admin/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "Request failed");
  }
  return res.json();
}

function getRoleLabel(role: BoltwallUser["role"]): string {
  if (role === "owner") return "Owner";
  if (role === "admin" || role === "sub_admin") return "Admin";
  return "Member";
}

function getInitials(name: string | null, pubkey: string | null): string {
  if (name) return name.slice(0, 2).toUpperCase();
  if (pubkey) return pubkey.slice(0, 2).toUpperCase();
  return "??";
}

// ─── CopyButton ──────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  }
  return (
    <Button variant="ghost" size="icon" onClick={handleCopy} aria-label={`Copy ${label}`}>
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

// ─── UserFormDialog ───────────────────────────────────────────────────────────

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: BoltwallUser;
  onSave: (data: { pubkey: string; name: string; role: string }) => Promise<void>;
}

function UserFormDialog({ open, onOpenChange, user, onSave }: UserFormDialogProps) {
  const [pubkey, setPubkey] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"sub_admin" | "member">("member");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPubkey(user?.pubkey ?? "");
      setName(user?.name ?? "");
      // Normalise sub_admin → sub_admin, admin → sub_admin
      const r = user?.role;
      setRole(r === "admin" || r === "sub_admin" ? "sub_admin" : "member");
    }
  }, [open, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ pubkey, name, role });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? "Edit User" : "Add User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="uf-pubkey">Pubkey</Label>
            <Input
              id="uf-pubkey"
              value={pubkey}
              onChange={(e) => setPubkey(e.target.value)}
              placeholder="03abc..."
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="uf-name">Name</Label>
            <Input
              id="uf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="uf-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "sub_admin" | "member")}>
              <SelectTrigger id="uf-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sub_admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !pubkey.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {user ? "Save Changes" : "Add User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── SetOwnerDialog ───────────────────────────────────────────────────────────

interface SetOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { pubkey: string; name: string }) => Promise<void>;
}

function SetOwnerDialog({ open, onOpenChange, onSave }: SetOwnerDialogProps) {
  const [pubkey, setPubkey] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPubkey("");
      setName("");
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ pubkey, name });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Owner</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="so-pubkey">Pubkey</Label>
            <Input
              id="so-pubkey"
              value={pubkey}
              onChange={(e) => setPubkey(e.target.value)}
              placeholder="03abc..."
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="so-name">Name</Label>
            <Input
              id="so-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !pubkey.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Set Owner
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
          setEndpoints(endpointsRes.value?.endpoints ?? []);
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

// ─── UserRow (sub-component) ─────────────────────────────────────────────────

function UserRow({
  user,
  onEdit,
  onDelete,
  onSetOwner,
}: {
  user: BoltwallUser;
  onEdit: () => void;
  onDelete: () => void;
  onSetOwner: () => void;
}) {
  const isOwner = user.role === "owner";
  const hasHive = !!user.hive;
  const displayName = hasHive ? user.hive!.name : null;

  return (
    <tr className="border-b last:border-0">
      {/* User cell */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {hasHive ? (
            <Avatar className="h-7 w-7 text-xs">
              <AvatarImage src={user.hive!.image ?? undefined} alt={displayName ?? ""} />
              <AvatarFallback>{getInitials(displayName, user.pubkey)}</AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="h-7 w-7 text-xs">
              <AvatarFallback>{getInitials(user.name, user.pubkey)}</AvatarFallback>
            </Avatar>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {hasHive && displayName
              ? displayName
              : user.pubkey
              ? `${user.pubkey.slice(0, 16)}…`
              : "—"}
          </span>
        </div>
      </td>
      {/* Role cell */}
      <td className="px-4 py-3">
        <Badge variant={isOwner ? "secondary" : "outline"}>{getRoleLabel(user.role)}</Badge>
      </td>
      {/* Actions cell */}
      <td className="px-4 py-3 text-right">
        {isOwner && user.pubkey === null ? (
          <Button size="sm" variant="outline" onClick={onSetOwner}>
            Set Owner
          </Button>
        ) : isOwner ? null : (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit user">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete user">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
