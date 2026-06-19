import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, X } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDebounce } from "@/hooks/useDebounce";
import { EvalSetRow } from "./EvalSetRow";
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
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const filteredEvalSets = evalSets.filter((e) =>
    String(e.properties?.name ?? "").toLowerCase().includes(debouncedSearchQuery.toLowerCase())
  );

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
      <div className="flex justify-between items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search eval sets..."
            className="w-full pl-9 pr-9 h-9 rounded-md border border-input bg-background text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New Eval Set
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[220px]">Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3].map((i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-64" /></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[220px]">Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEvalSets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-32 text-center">
                    <p className="text-muted-foreground">
                      {evalSets.length === 0
                        ? "No eval sets yet — create one to get started"
                        : "No eval sets match your search"}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredEvalSets.map((evalSet) => (
                  <EvalSetRow
                    key={evalSet.ref_id}
                    evalSet={evalSet}
                    onClick={() => setSelected(evalSet)}
                    onEdit={() => setEditTarget(evalSet)}
                    onDelete={() => handleDelete(evalSet)}
                  />
                ))
              )}
            </TableBody>
          </Table>
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
