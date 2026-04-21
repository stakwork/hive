"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Loader2 } from "lucide-react";
import type { UserFormDialogProps } from "../types";

export function UserFormDialog({ open, onOpenChange, user, onSave }: UserFormDialogProps) {
  const [pubkey, setPubkey] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"sub_admin" | "member">("member");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPubkey(user?.pubkey ?? "");
      setName(user?.name ?? "");
      // Normalise admin → sub_admin
      const r = user?.role;
      setRole(r === "admin" ? "sub_admin" : "member");
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
