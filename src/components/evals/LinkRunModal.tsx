import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { JarvisNode } from "@/types/jarvis";

interface LinkRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evalSetId: string;
  reqId: string;
  onLinked: () => void;
}

export function LinkRunModal({
  open,
  onOpenChange,
  evalSetId,
  reqId,
  onLinked,
}: LinkRunModalProps) {
  const { slug } = useWorkspace();
  const [sessions, setSessions] = useState<JarvisNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(new Set());
    setLoading(true);
    fetch(`/api/workspaces/${slug}/evals/sessions`)
      .then((r) => r.json())
      .then((data) => setSessions(data?.data?.nodes ?? []))
      .catch(() => toast.error("Failed to load sessions"))
      .finally(() => setLoading(false));
  }, [open, slug]);

  const filtered = sessions.filter((s) =>
    String(s.properties?.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function toggleSession(refId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(refId) ? next.delete(refId) : next.add(refId);
      return next;
    });
  }

  async function handleConfirm() {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/evals/${evalSetId}/requirements/${reqId}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_ids: Array.from(selected) }),
        },
      );
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      toast.success(`Linked ${data?.linked ?? selected.size} session(s)`);
      onLinked();
      onOpenChange(false);
    } catch {
      toast.error("Failed to link sessions");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Agent Sessions</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="max-h-72 overflow-y-auto space-y-1 rounded-md border p-2">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No agent sessions found
              </p>
            ) : (
              filtered.map((session) => {
                const name = String(session.properties?.name ?? session.ref_id);
                const date = session.properties?.date
                  ? String(session.properties.date)
                  : null;
                const isChecked = selected.has(session.ref_id);
                return (
                  <label
                    key={session.ref_id}
                    className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleSession(session.ref_id)}
                    />
                    <span className="flex-1 text-sm font-medium">{name}</span>
                    {date && (
                      <span className="text-xs text-muted-foreground">{date}</span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selected.size === 0 || submitting}
          >
            {submitting ? "Linking..." : `Confirm (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
