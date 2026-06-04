"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface WorkspaceSecret {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

interface FormState {
  name: string;
  value: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: "", value: "", description: "" };

export function SecretsPanel() {
  const { workspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();

  const [secrets, setSecrets] = useState<WorkspaceSecret[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const slug = workspace?.slug;

  const fetchSecrets = useCallback(async () => {
    if (!slug) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/secrets`);
      if (!res.ok) throw new Error("Failed to load secrets");
      const data = await res.json();
      setSecrets(data.secrets ?? []);
    } catch {
      toast.error("Failed to load secrets");
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.value.trim()) {
      toast.error("Name and value are required");
      return;
    }
    setIsCreating(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          value: form.value,
          description: form.description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create secret");
        return;
      }
      toast.success("Secret created successfully");
      setIsCreateDialogOpen(false);
      setForm(EMPTY_FORM);
      await fetchSecrets();
    } catch {
      toast.error("Failed to create secret");
    } finally {
      setIsCreating(false);
    }
  };

  if (!canAdmin) return null;

  return (
    <>
      <Card className="flex-1 m-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Secrets</CardTitle>
          <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create Secret
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : secrets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <KeyRound className="h-8 w-8" />
              <p className="text-sm">No secrets yet. Create one to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((secret) => (
                  <TableRow key={secret.id}>
                    <TableCell className="font-mono text-sm">{secret.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {secret.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(secret.createdAt), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) setForm(EMPTY_FORM);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Secret</DialogTitle>
            <DialogDescription>
              Secret values are write-only and will never be shown again after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="secret-name">Name *</Label>
              <Input
                id="secret-name"
                placeholder="MY_SECRET_NAME"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret-value">Value *</Label>
              <Input
                id="secret-value"
                type="password"
                placeholder="Enter secret value"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret-description">Description</Label>
              <Input
                id="secret-description"
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Use {"{{"}<span>SECRET_NAME</span>{"}}"} to reference this secret in workflows.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false);
                setForm(EMPTY_FORM);
              }}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
