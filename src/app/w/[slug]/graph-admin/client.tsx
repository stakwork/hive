"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExternalLink, Loader2, AlertCircle, RefreshCw, Zap, Plus, Pencil, Check, Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import type { PaidEndpoint, BoltwallUser, GraphAdminClientProps, SecondBrainAbout } from "./types";
import { postGraphAdminCmd, roleToNumber } from "./utils";
import { CopyButton, UserRow, UserFormDialog, SetOwnerDialog } from "./components";

export function GraphAdminClient({ swarmUrl, workspaceSlug, workspaceName }: GraphAdminClientProps) {
  const hostname = swarmUrl ? new URL(swarmUrl).hostname : null;

  // ── Graph/Endpoints state ──
  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  const [endpoints, setEndpoints] = useState<PaidEndpoint[] | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [endpointLoadingIds, setEndpointLoadingIds] = useState<Set<number>>(new Set());
  const [endpointPriceLoadingIds, setEndpointPriceLoadingIds] = useState<Set<number>>(new Set());
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>("");

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

  // ── Graph title state ──
  const [graphTitle, setGraphTitle] = useState<string | null>(null);
  const [titleLoading, setTitleLoading] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [cachedAbout, setCachedAbout] = useState<SecondBrainAbout | null>(null);
  const [titleSaving, setTitleSaving] = useState(false);

  // ── Load graph/endpoints on mount ──
  useEffect(() => {
    if (!swarmUrl) {
      setInitialLoading(false);
      setTitleLoading(false);
      return;
    }

    let cancelled = false;
    async function loadInitialState() {
      try {
        const [visibilityRes, endpointsRes, aboutRes] = await Promise.allSettled([
          postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } }),
          postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "ListPaidEndpoint" } }),
          postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "GetSecondBrainAboutDetails" } }),
        ]);
        if (cancelled) return;
        if (visibilityRes.status === "fulfilled") {
          setIsPublic(visibilityRes.value?.data?.isPublic ?? visibilityRes.value?.isPublic ?? false);
        } else {
          toast.error("Failed to load graph visibility");
        }
        if (endpointsRes.status === "fulfilled") {
          const res = endpointsRes.value;
          setEndpoints(res?.endpoints ?? (Array.isArray(res) ? res : []));
        } else {
          toast.error("Failed to load payment routes");
        }
        if (aboutRes.status === "fulfilled") {
          const about = aboutRes.value as SecondBrainAbout;
          setCachedAbout(about);
          setGraphTitle(about?.title ?? null);
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
          setTitleLoading(false);
        }
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
      const msats = typeof res === "number" ? res : (res?.data?.msat ?? null);
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
      const res = await postGraphAdminCmd(workspaceSlug, { type: "Swarm", data: { cmd: "GetBoltwallUsers" } });
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
      const confirmed = await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "GetBoltwallAccessibility" },
      });
      setIsPublic(confirmed?.data?.isPublic ?? confirmed?.isPublic ?? newValue);
      toast.success("Graph visibility updated");
    } catch {
      setIsPublic(previous);
      toast.error("Failed to update visibility");
    } finally {
      setVisibilityLoading(false);
    }
  }

  // ── Graph title save ──
  async function handleSaveTitle() {
    if (!titleDraft.trim() || titleSaving) return;
    setTitleSaving(true);
    const previous = { graphTitle, cachedAbout };
    setGraphTitle(titleDraft);
    setIsEditingTitle(false);
    try {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: {
          cmd: "UpdateSecondBrainAbout",
          content: { ...(cachedAbout ?? { description: "" }), title: titleDraft },
        },
      });
      setCachedAbout((prev) => (prev ? { ...prev, title: titleDraft } : prev));
      toast.success("Graph title updated");
    } catch {
      setGraphTitle(previous.graphTitle);
      setCachedAbout(previous.cachedAbout);
      toast.error("Failed to update graph title");
    } finally {
      setTitleSaving(false);
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

  // ── Endpoint price edit ──
  async function handlePriceEdit(id: number, price: number) {
    const previous = endpoints;
    setEndpoints((prev) =>
      prev ? prev.map((e) => (e.id === id ? { ...e, price } : e)) : prev,
    );
    setEndpointPriceLoadingIds((prev) => new Set(prev).add(id));
    setEditingPriceId(null);
    try {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "UpdateEndpointPrice", content: { id, price } },
      });
      toast.success("Price updated");
    } catch {
      setEndpoints(previous);
      toast.error("Failed to update price");
    } finally {
      setEndpointPriceLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
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
      const invoice = res?.bolt11 ?? "";
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
    const roleNum = roleToNumber(data.role);
    if (editingUser) {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: {
          cmd: "UpdateUser",
          content: { id: editingUser.id!, pubkey: data.pubkey, name: data.name, role: roleNum },
        },
      });
      toast.success("User updated");
    } else {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "AddBoltwallUser", content: { pubkey: data.pubkey, name: data.name, role: roleNum } },
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
    <div className="space-y-8">
      {/* ── Identity Bar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {titleLoading ? (
              <Skeleton className="h-8 w-48" />
            ) : isEditingTitle ? (
              <div className="flex items-center gap-1">
                <Input
                  className="h-8 text-xl font-bold"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle();
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                  autoFocus
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={!titleDraft.trim() || titleSaving}
                  onClick={handleSaveTitle}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight">
                  {graphTitle ?? workspaceName}
                </h1>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => {
                    setTitleDraft(graphTitle ?? workspaceName);
                    setIsEditingTitle(true);
                  }}
                  aria-label="Edit graph title"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            {hostname && <span className="font-mono text-xs">{hostname}</span>}
            {isPublic !== null && !initialLoading && (
              <>
                <span className="text-border/60">·</span>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    isPublic
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {isPublic ? "Public" : "Private"}
                </span>
              </>
            )}
          </div>
        </div>
        {hostname && (
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <a
              href={`https://${hostname}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              Viewer
              <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-border/40">·</span>
            <a
              href={`https://${hostname}:8800`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              Dashboard
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      {/* ── Balance Hero ── */}
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/[0.04] via-transparent to-orange-500/[0.03] dark:from-amber-400/[0.06] dark:to-orange-400/[0.04]" />
        <div className="relative px-6 py-10 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 dark:bg-amber-400/10">
              <Zap className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            </div>
            {balanceLoading ? (
              <Skeleton className="h-[3.5rem] w-52" />
            ) : (
              <span className="text-[3.5rem] font-bold leading-none tracking-tight tabular-nums">
                {botBalance !== null ? botBalance.toLocaleString() : "—"}
              </span>
            )}
          </div>
          <p className="mt-2.5 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            sats
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchBotBalance}
            disabled={balanceLoading}
            className="mt-4 h-7 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`mr-1.5 h-3 w-3 ${balanceLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Grid: Access + Receive ── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Access */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Access
            </CardTitle>
          </CardHeader>
          <CardContent>
            {initialLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{isPublic ? "Public" : "Private"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {isPublic
                      ? "Anyone can view your graph and its content"
                      : "Only authorized members can access"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {visibilityLoading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  <Switch
                    checked={isPublic ?? false}
                    onCheckedChange={handleVisibilityToggle}
                    disabled={visibilityLoading}
                    aria-label="Toggle graph visibility"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Receive */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Receive
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleGenerateInvoice} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="invoice-sats" className="text-xs">
                  Amount (sats)
                </Label>
                <Input
                  id="invoice-sats"
                  type="number"
                  min={1}
                  placeholder="0"
                  value={invoiceSats}
                  onChange={(e) => setInvoiceSats(e.target.value)}
                  className="h-9"
                />
              </div>
              <Button type="submit" size="sm" disabled={!invoiceSats || invoiceLoading} className="h-9 shrink-0">
                {invoiceLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="mr-1.5 h-3.5 w-3.5" />
                )}
                Generate
              </Button>
            </form>

            {invoiceResult && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                {invoiceResult.qrCodeDataUrl && (
                  <img
                    src={invoiceResult.qrCodeDataUrl}
                    alt="Lightning invoice QR"
                    className="mx-auto h-40 w-40"
                  />
                )}
                <div className="flex items-center gap-2">
                  <p className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {invoiceResult.invoice}
                  </p>
                  <CopyButton value={invoiceResult.invoice} label="Invoice" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Payment Routes ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Payment Routes
          </CardTitle>
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
            <div className="rounded-lg border">
              {endpoints.map((endpoint, idx) => {
                const isToggleLoading = endpointLoadingIds.has(endpoint.id);
                const isPriceLoading = endpointPriceLoadingIds.has(endpoint.id);
                const isEditingPrice = editingPriceId === endpoint.id;
                return (
                  <div
                    key={endpoint.id}
                    className={`flex items-center justify-between gap-4 px-4 py-3 ${
                      idx > 0 ? "border-t" : ""
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-mono text-sm font-medium">/{endpoint.endpoint}</span>
                      {endpoint.route_description && (
                        <span className="truncate text-xs text-muted-foreground">
                          {endpoint.route_description}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {isPriceLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : isEditingPrice ? (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            className="h-7 w-24 text-xs"
                            value={editingPriceValue}
                            onChange={(e) => setEditingPriceValue(e.target.value)}
                            autoFocus
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={editingPriceValue === "" || Number(editingPriceValue) === endpoint.price}
                            onClick={() => handlePriceEdit(endpoint.id, Number(editingPriceValue))}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="tabular-nums text-xs text-muted-foreground">
                            {endpoint.price} sats
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingPriceId(endpoint.id);
                              setEditingPriceValue(String(endpoint.price));
                            }}
                            aria-label={`Edit price for /${endpoint.endpoint}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {isToggleLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Switch
                          checked={endpoint.status}
                          onCheckedChange={() => handleEndpointToggle(endpoint)}
                          aria-label={`Toggle /${endpoint.endpoint}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Users ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Users
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setEditingUser(undefined); setUserFormOpen(true); }}
            className="h-8 text-xs"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
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
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">User</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Role</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
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

      {/* ── Dialogs ── */}
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
