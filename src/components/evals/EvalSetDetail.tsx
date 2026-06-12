import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionMenu } from "@/components/ui/action-menu";
import { ArrowLeft, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { CreateRequirementModal } from "./CreateRequirementModal";
import { EditRequirementModal } from "./EditRequirementModal";
import { CaptureEvalTriggerModal } from "./CaptureEvalTriggerModal";
import { EvalTriggerList } from "./EvalTriggerList";
import type { JarvisNode } from "@/types/jarvis";

interface EvalSetDetailProps {
  evalSet: JarvisNode;
  onBack: () => void;
}

interface RequirementNode extends JarvisNode {
  properties: {
    name?: string;
    description?: string;
    prompt_snippet?: string;
    positive_cases?: string[];
    negative_cases?: string[];
    linked_session_count?: number;
    order?: number;
    [key: string]: unknown;
  };
}

export function EvalSetDetail({ evalSet, onBack }: EvalSetDetailProps) {
  const { slug } = useWorkspace();
  const [requirements, setRequirements] = useState<RequirementNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ reqId: string } | null>(null);
  const [editReqTarget, setEditReqTarget] = useState<RequirementNode | null>(null);

  async function fetchRequirements() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/evals/${evalSet.ref_id}/requirements`,
      );
      const data = await res.json();
      const nodes: RequirementNode[] = (data?.data?.nodes ?? []).sort(
        (a: RequirementNode, b: RequirementNode) =>
          (Number(a.properties?.order) || 0) - (Number(b.properties?.order) || 0),
      );
      setRequirements(nodes);
    } catch {
      toast.error("Failed to load requirements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRequirements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalSet.ref_id, slug]);

  async function handleDeleteRequirement(reqId: string) {
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/evals/${evalSet.ref_id}/requirements/${reqId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Request failed");
      toast.success("Requirement deleted");
      fetchRequirements();
    } catch {
      toast.error("Failed to delete requirement");
    }
  }

  const evalSetName = String(evalSet.properties?.name ?? "Eval Set");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{evalSetName}</h2>
            {!!evalSet.properties?.description && (
              <p className="text-sm text-muted-foreground">
                {String(evalSet.properties.description)}
              </p>
            )}
          </div>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Requirement
        </Button>
      </div>

      {/* Requirements list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : requirements.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No requirements yet — add one to get started
        </div>
      ) : (
        <div className="space-y-3">
          {requirements.map((req) => {
            const name = String(req.properties?.name ?? req.ref_id);
            const description = req.properties?.description
              ? String(req.properties.description)
              : null;
            const promptSnippet = req.properties?.prompt_snippet
              ? String(req.properties.prompt_snippet)
              : null;
            const posCount = Array.isArray(req.properties?.positive_cases)
              ? req.properties.positive_cases.length
              : 0;
            const negCount = Array.isArray(req.properties?.negative_cases)
              ? req.properties.negative_cases.length
              : 0;
            const sessionCount =
              typeof req.properties?.linked_session_count === "number"
                ? req.properties.linked_session_count
                : 0;

            return (
              <div
                key={req.ref_id}
                className="rounded-lg border bg-card p-4"
                data-testid="requirement-row"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{name}</span>
                      <Badge variant="outline" className="text-xs">
                        +{posCount} / -{negCount}
                      </Badge>
                      {sessionCount > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    {description && (
                      <p className="text-sm text-muted-foreground">{description}</p>
                    )}
                    {promptSnippet && (
                      <p className="truncate text-xs text-muted-foreground font-mono bg-muted rounded px-2 py-1">
                        {promptSnippet}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLinkTarget({ reqId: req.ref_id })}
                    >
                      <Zap className="mr-1 h-3 w-3" />
                      Capture Trigger
                    </Button>
                    <ActionMenu
                      actions={[
                        {
                          label: "Edit",
                          icon: Pencil,
                          onClick: () => setEditReqTarget(req),
                        },
                        {
                          label: "Delete",
                          icon: Trash2,
                          variant: "destructive",
                          confirmation: {
                            title: "Delete requirement?",
                            description:
                              "This will permanently remove this requirement from the eval set.",
                            confirmText: "Delete",
                            onConfirm: () => handleDeleteRequirement(req.ref_id),
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
                <EvalTriggerList
                  evalSetId={evalSet.ref_id}
                  reqId={req.ref_id}
                  slug={slug}
                />
              </div>
            );
          })}
        </div>
      )}

      <CreateRequirementModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        evalSetId={evalSet.ref_id}
        order={requirements.length}
        onCreated={fetchRequirements}
      />

      {linkTarget && (
        <CaptureEvalTriggerModal
          open={!!linkTarget}
          onOpenChange={(o) => { if (!o) setLinkTarget(null); }}
          evalSetId={evalSet.ref_id}
          reqId={linkTarget.reqId}
          onCreated={fetchRequirements}
        />
      )}

      {editReqTarget !== null && (
        <EditRequirementModal
          open={true}
          onOpenChange={(open) => { if (!open) setEditReqTarget(null); }}
          evalSetId={evalSet.ref_id}
          requirement={editReqTarget}
          onUpdated={() => {
            fetchRequirements();
            setEditReqTarget(null);
          }}
        />
      )}
    </div>
  );
}
