"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SwarmPasswordUpdateFormProps {
  workspaceId: string;
  hasPassword: boolean;
  onSuccess: () => void;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // Fall through to status-based message.
  }
  return `Request failed (${res.status})`;
}

export default function SwarmPasswordUpdateForm({
  workspaceId,
  hasPassword,
  onSuccess,
}: SwarmPasswordUpdateFormProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const submitPassword = async (value: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/swarm-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swarmPassword: value }),
      });

      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }

      setPassword("");
      onSuccess();
    } catch {
      setError("Network error while updating swarm password");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    if (!trimmed) {
      setError("Password cannot be empty");
      return;
    }
    if (hasPassword) {
      setConfirmOpen(true);
      return;
    }
    void submitPassword(trimmed);
  };

  const handleConfirm = () => {
    const trimmed = password.trim();
    setConfirmOpen(false);
    if (!trimmed) {
      setError("Password cannot be empty");
      return;
    }
    void submitPassword(trimmed);
  };

  return (
    <div data-testid="swarm-password-update-form">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          placeholder="New swarm password"
          autoComplete="new-password"
          disabled={submitting}
          className="w-56"
          data-testid="swarm-password-input"
        />
        <Button type="submit" size="sm" disabled={submitting} data-testid="swarm-password-submit">
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : hasPassword ? (
            "Replace password"
          ) : (
            "Set password"
          )}
        </Button>
      </form>
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert" data-testid="swarm-password-error">
          {error}
        </p>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="swarm-password-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Replace stored swarm password?</DialogTitle>
            <DialogDescription>
              This overwrites the current stored credential. Cancel leaves it unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              data-testid="swarm-password-confirm-cancel"
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} data-testid="swarm-password-confirm">
              Replace password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
