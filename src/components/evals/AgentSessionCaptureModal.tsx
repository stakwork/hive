"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { CaptureEvalForm, CREATE_NEW_VALUE } from "@/components/evals/CaptureEvalForm";

interface AgentSessionCaptureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  logId: string;
  turnIndex?: number; // undefined = entire session
}

export function AgentSessionCaptureModal({
  open,
  onOpenChange,
  slug,
  logId,
  turnIndex,
}: AgentSessionCaptureModalProps) {
  const [requirement, setRequirement] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [evalSets, setEvalSets] = useState<Array<{ ref_id: string; name: string }>>([]);
  const [loadingEvalSets, setLoadingEvalSets] = useState(false);
  const [evalSetsError, setEvalSetsError] = useState(false);
  const [selectedEvalSetId, setSelectedEvalSetId] = useState("");
  const [newEvalSetName, setNewEvalSetName] = useState("");

  const title =
    turnIndex === undefined
      ? "Capture Eval — Entire Session"
      : `Capture Eval — Up to Turn ${turnIndex + 1}`;

  // Fetch eval sets when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingEvalSets(true);
    setEvalSetsError(false);
    fetch(`/api/workspaces/${slug}/evals`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const nodes: Array<{ ref_id: string; properties?: { name?: string }; name?: string }> =
          data?.data?.nodes ?? data?.data ?? [];
        const sets = nodes.map((n) => ({
          ref_id: n.ref_id,
          name: n.properties?.name ?? n.name ?? "",
        }));
        setEvalSets(sets);
        const lastUsed =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("lastUsedEvalSetId")
            : null;
        if (lastUsed && sets.some((s) => s.ref_id === lastUsed)) {
          setSelectedEvalSetId(lastUsed);
        } else if (sets.length > 0) {
          setSelectedEvalSetId(sets[0].ref_id);
        }
      })
      .catch(() => {
        if (!cancelled) setEvalSetsError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingEvalSets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setRequirement("");
      setReason("");
      setSubmitting(false);
      setEvalSets([]);
      setLoadingEvalSets(false);
      setEvalSetsError(false);
      setSelectedEvalSetId("");
      setNewEvalSetName("");
    }
  }, [open]);

  async function handleConfirm() {
    if (!requirement.trim()) return;
    if (!selectedEvalSetId) return;
    if (selectedEvalSetId === CREATE_NEW_VALUE && !newEvalSetName.trim()) return;

    setSubmitting(true);
    try {
      let resolvedEvalSetId = selectedEvalSetId;

      if (selectedEvalSetId === CREATE_NEW_VALUE) {
        const createRes = await fetch(`/api/workspaces/${slug}/evals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newEvalSetName.trim() }),
        });
        if (!createRes.ok) {
          toast.error("Failed to create eval set");
          return;
        }
        const createData = await createRes.json();
        resolvedEvalSetId = createData?.data?.ref_id ?? createData?.ref_id;
        if (!resolvedEvalSetId) {
          toast.error("Failed to create eval set");
          return;
        }
      }

      if (typeof localStorage !== "undefined") {
        localStorage.setItem("lastUsedEvalSetId", resolvedEvalSetId);
      }

      const body: Record<string, unknown> = {
        evalSetId: resolvedEvalSetId,
        requirement: requirement.trim(),
        reason: reason.trim() || undefined,
      };
      if (turnIndex !== undefined) {
        body.turnIndex = turnIndex;
      }

      const res = await fetch(
        `/api/workspaces/${slug}/agent-logs/${logId}/eval/capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error("Request failed");
      toast.success("Eval captured");
      onOpenChange(false);
    } catch {
      toast.error("Failed to capture eval");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <CaptureEvalForm
          requirement={requirement}
          reason={reason}
          onRequirementChange={setRequirement}
          onReasonChange={setReason}
          submitting={submitting}
          evalSets={evalSets}
          loadingEvalSets={loadingEvalSets}
          evalSetsError={evalSetsError}
          selectedEvalSetId={selectedEvalSetId}
          onSelectEvalSet={setSelectedEvalSetId}
          newEvalSetName={newEvalSetName}
          onNewEvalSetNameChange={setNewEvalSetName}
        />

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              submitting ||
              !requirement.trim() ||
              !selectedEvalSetId ||
              (selectedEvalSetId === CREATE_NEW_VALUE && !newEvalSetName.trim())
            }
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
