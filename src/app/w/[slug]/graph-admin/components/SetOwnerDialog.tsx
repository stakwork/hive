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
import { Loader2 } from "lucide-react";
import type { SetOwnerDialogProps } from "../types";

export function SetOwnerDialog({ open, onOpenChange, onSave }: SetOwnerDialogProps) {
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
