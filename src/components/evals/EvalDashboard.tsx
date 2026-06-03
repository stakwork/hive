import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { EvalSetCard } from "./EvalSetCard";
import { EvalSetDetail } from "./EvalSetDetail";
import { CreateEvalSetModal } from "./CreateEvalSetModal";
import { EditEvalSetModal } from "./EditEvalSetModal";
import type { JarvisNode } from "@/types/jarvis";

export function EvalDashboard() {
  const { slug } = useWorkspace();
  const [evalSets, setEvalSets] = useState<JarvisNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<JarvisNode | null>(null);
  const [editTarget, setEditTarget] = useState<JarvisNode | null>(null);

  async function fetchEvalSets() {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/evals`);
      const data = await res.json();
      setEvalSets(data?.data?.nodes ?? []);
    } catch {
      toast.error("Failed to load eval sets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEvalSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function handleDelete(evalSet: JarvisNode) {
    try {
      const res = await fetch(`/api/workspaces/${slug}/evals/${evalSet.ref_id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Request failed");
      toast.success("Eval set deleted");
      fetchEvalSets();
    } catch {
      toast.error("Failed to delete eval set");
    }
  }

  if (selected) {
    return (
      <EvalSetDetail
        evalSet={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New Eval Set
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : evalSets.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-14 text-center text-sm text-muted-foreground"
          data-testid="empty-state"
        >
          No eval sets yet — create one to get started
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {evalSets.map((evalSet) => (
            <EvalSetCard
              key={evalSet.ref_id}
              evalSet={evalSet}
              onClick={() => setSelected(evalSet)}
              onEdit={() => setEditTarget(evalSet)}
              onDelete={() => handleDelete(evalSet)}
            />
          ))}
        </div>
      )}

      <CreateEvalSetModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          fetchEvalSets();
          setCreateOpen(false);
        }}
      />

      {editTarget !== null && (
        <EditEvalSetModal
          open={true}
          onOpenChange={(open) => { if (!open) setEditTarget(null); }}
          evalSet={editTarget}
          onUpdated={() => {
            fetchEvalSets();
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}
