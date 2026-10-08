"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { UnifiedDiffView } from "@/components/diff/UnifiedDiffView";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";
import { computeUnifiedDiff } from "@/lib/diff/unifiedLineDiff";
import { nodeText } from "@/lib/strut-run-graph/node-text";
import { cn } from "@/lib/utils";
import type { ConnectionGroup } from "@/services/graph/workbench";
import type { NodeEdit } from "./changes";
import { childrenOf, hasDocs, parentsOf, type WorkbenchGraph } from "./model";
import {
  CONNECTION_PAGE,
  connectionPageQuery,
  connectionsQuery,
  deleteConcept,
  hierarchyQuery,
  saveConceptDocs,
  workbenchKey,
  workspaceRoleQuery,
} from "./queries";
import { useWorkbench } from "./store";

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
);

/** A section label with an action at its end. */
const LabelRow = ({ label, action }: { label: string; action?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2">
    <SectionLabel>{label}</SectionLabel>
    {action}
  </div>
);

function TypeBadge({ type }: { type: string }) {
  return <span className="shrink-0 rounded border px-1.5 text-[11px] leading-5 text-muted-foreground">{type}</span>;
}

function NodeChips({ label, ids, graph }: { label: string; ids: string[]; graph: WorkbenchGraph }) {
  const { select } = useWorkbench();
  return (
    <div className="space-y-1.5">
      <SectionLabel>
        {label} <span className="tabular-nums">{ids.length}</span>
      </SectionLabel>
      {ids.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              className="max-w-full truncate rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
            >
              {graph.nodes[id]?.name ?? id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NeighbourList({ refId, group }: { refId: string; group: ConnectionGroup }) {
  const { slug, select } = useWorkbench();
  const [limit, setLimit] = useState(CONNECTION_PAGE);
  const { data: items, error } = useQuery({
    ...connectionPageQuery(slug, { refId, edge: group.edge, outgoing: group.outgoing, other: group.other, limit }),
    // "Show more" keeps what's listed while the longer list loads.
    placeholderData: keepPreviousData,
  });

  if (error) return <p className="px-7 pb-2 text-xs text-muted-foreground">{error.message}</p>;
  if (!items) return <p className="px-7 pb-2 text-xs text-muted-foreground">Loading…</p>;
  return (
    <div className="pb-1.5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => select(item.id)}
          className="block w-full truncate px-7 py-0.5 text-left text-xs hover:bg-accent/50"
          title={item.name}
        >
          {item.name}
        </button>
      ))}
      {group.count > items.length && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + CONNECTION_PAGE)}
          className="px-7 pt-1 text-xs text-muted-foreground hover:underline"
        >
          Show more · {(group.count - items.length).toLocaleString()} not shown
        </button>
      )}
    </div>
  );
}

/**
 * Every edge group around a node, counts first; a group loads its neighbours
 * only when opened — one can hold thousands.
 */
function Connections({ refId, groups }: { refId: string; groups: ConnectionGroup[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-1.5" data-testid="graph-workbench-connections">
      <SectionLabel>Connections</SectionLabel>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">No other connections.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {groups.map((g) => {
            const key = `${g.edge}|${g.outgoing}|${g.other}`;
            const isOpen = open === key;
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : key)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent/50"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                      isOpen && "rotate-90",
                    )}
                  />
                  <span className="w-3 shrink-0 text-center text-muted-foreground">{g.outgoing ? "→" : "←"}</span>
                  <span className="truncate font-mono text-[11px]">{g.edge}</span>
                  <span className="truncate text-muted-foreground">{g.other}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">{g.count.toLocaleString()}</span>
                </button>
                {isOpen && <NeighbourList refId={refId} group={g} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const display = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** A proposed docs or property change on a node, as a line diff. */
function ProposedEdit({ edit }: { edit: NodeEdit }) {
  const diff = useMemo(() => computeUnifiedDiff(edit.before, edit.after), [edit.before, edit.after]);
  return (
    <div
      className="space-y-1.5 rounded-md border border-dashed border-emerald-500 p-2"
      data-testid="graph-workbench-proposed-edit"
    >
      <SectionLabel>
        Proposed {edit.kind === "docs" ? "docs" : "properties"}{" "}
        <span className="normal-case tracking-normal tabular-nums">
          +{diff.added} −{diff.removed}
        </span>
      </SectionLabel>
      <div className="max-h-96 overflow-auto text-xs">
        <UnifiedDiffView diff={diff} />
      </div>
    </div>
  );
}

/**
 * A concept's docs as markdown, saved back to the graph. ⌘↵ saves; Esc
 * leaves while nothing has changed.
 */
function DocsEditor({
  refId,
  type,
  docs,
  namespace,
  onDone,
}: {
  refId: string;
  type: string;
  docs: string;
  /** The node's Jarvis namespace, when known — see `NodeDetails`' `conceptNamespace`. */
  namespace?: string;
  onDone: () => void;
}) {
  const { slug } = useWorkbench();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(docs);
  const settled = useDeferredValue(draft);
  const diff = useMemo(() => computeUnifiedDiff(docs, settled), [docs, settled]);
  const changed = draft !== docs;
  const save = useMutation({
    mutationFn: (text: string) => saveConceptDocs(slug, refId, text, namespace),
    onSuccess: (_, text) => {
      // The swarm holds the new docs now: show them without reading the whole graph again.
      queryClient.setQueryData(
        hierarchyQuery(slug, type).queryKey,
        (h) => h && { ...h, nodes: h.nodes.map((n) => (n.id === refId ? { ...n, docs: text } : n)) },
      );
      queryClient.setQueryData(
        connectionsQuery(slug, refId).queryKey,
        (c) => c && { ...c, node: { ...c.node, properties: { ...c.node.properties, docs: text } } },
      );
      onDone();
    },
  });

  return (
    <div className="space-y-1.5" data-testid="graph-workbench-docs-editor">
      <SectionLabel>Docs</SectionLabel>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && changed) save.mutate(draft);
          else if (e.key === "Escape" && !changed) onDone();
        }}
        autoFocus
        placeholder="Markdown: what an agent should know when it reads this concept"
        className="max-h-[60vh] min-h-64 text-xs leading-relaxed md:text-xs"
        disabled={save.isPending}
      />
      <div className="flex items-center gap-2">
        <span className="mr-auto truncate text-[11px] tabular-nums text-muted-foreground">
          {save.error ? save.error.message : changed ? `+${diff.added} −${diff.removed}` : "No changes yet"}
        </span>
        <Button variant="ghost" size="sm" className="h-7" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7"
          onClick={() => save.mutate(draft)}
          disabled={!changed || save.isPending}
          title="Save (⌘↵)"
          data-testid="graph-workbench-save-docs"
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/** One node, whichever type: where it sits, what it says, how it connects. */
export function NodeDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { slug, graph, pending, select } = useWorkbench();
  const node = graph?.nodes[id];
  const isNew = node?.proposed === "new";
  const edit = node?.edit;
  const links = [
    ...pending.links.map((l) => ({ ...l, going: false })),
    ...pending.unlinks.map((l) => ({ ...l, going: true })),
  ].filter((l) => l.source === id || l.target === id);
  // A proposed node isn't in the graph yet: nothing to read.
  const { data, error, isLoading: loading } = useQuery({ ...connectionsQuery(slug, id), enabled: !isNew });
  const name = node?.name ?? data?.node.name ?? (loading ? "Loading…" : id);
  const type = node?.type ?? data?.node.type ?? "Node";
  const documented = !!node && hasDocs(node);
  // Without docs, show the first property that reads as text, and the rest as fields.
  const { prose, rest } = nodeText(data?.node.properties ?? {});
  const text = documented ? undefined : prose[0];
  const fields = documented ? [] : [...prose.slice(1), ...rest];
  // The tree's own edge already has its sections (parents and children).
  const groups = (data?.groups ?? []).filter((g) => !(node && graph && g.edge === graph.lens.edge && g.other === type));
  const { data: role } = useQuery(workspaceRoleQuery(slug));
  // Developers and up edit a Concept's docs in place; a proposal's node can't be, until it's approved or rejected.
  const canEdit = !!role && hasRoleLevel(role, WorkspaceRole.DEVELOPER);
  const conceptRef = canEdit && node && !node.proposed && node.type === "Concept" ? node.id : null;
  // `connectionsQuery` reads this node via a raw `ref_id` Cypher match, not
  // Jarvis's namespace-scoped REST API, so it sees `namespace` even for a
  // Concept outside the default partition — carry it along to the docs save
  // and delete requests so THEIR namespace-scoped lookups don't miss it.
  const conceptNamespace =
    typeof data?.node.properties?.namespace === "string" ? data.node.properties.namespace : undefined;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (refId: string) => deleteConcept(slug, refId, conceptNamespace),
    onSuccess: async () => {
      toast.success(`Deleted "${name}"`);
      setConfirmDelete(false);
      onClose();
      await queryClient.invalidateQueries({ queryKey: workbenchKey(slug) });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to delete concept");
      setConfirmDelete(false);
    },
  });
  const editDocs = conceptRef && (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      data-testid="graph-workbench-edit-docs"
    >
      <Pencil className="h-3 w-3" />
      {node?.docs?.trim() ? "Edit" : "Write docs"}
    </button>
  );

  return (
    <div className="space-y-5" data-testid="graph-workbench-details">
      <div className="flex items-center gap-2">
        <TypeBadge type={type} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {(isNew || edit || links.length > 0) && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {isNew
            ? "Proposed — this node doesn't exist until the proposal is approved."
            : "This node has a proposed change."}
        </p>
      )}

      {edit && <ProposedEdit edit={edit} />}

      {links.length > 0 && graph && (
        <div className="space-y-1.5">
          <SectionLabel>Proposed links</SectionLabel>
          {links.map((l) => {
            const other = l.source === id ? l.target : l.source;
            return (
              <button
                key={`${l.going ? "going" : "proposed"}:${l.edge}:${l.source}>${l.target}`}
                type="button"
                onClick={() => select(other)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-1 text-left text-xs hover:bg-accent/50",
                  l.going ? "border-rose-500" : "border-emerald-500",
                )}
                title={l.going ? "This link would be removed" : "This link would be added"}
              >
                <span className="text-muted-foreground">{l.source === id ? "→" : "←"}</span>
                <span className="font-mono text-[11px]">{l.edge}</span>
                <span className="truncate">{graph.nodes[other]?.name ?? other}</span>
              </button>
            );
          })}
        </div>
      )}

      {editing && node && conceptRef ? (
        <DocsEditor
          refId={conceptRef}
          type={node.type}
          docs={node.docs ?? ""}
          namespace={conceptNamespace}
          onDone={() => setEditing(false)}
        />
      ) : documented ? (
        <div className="space-y-1">
          <LabelRow label="Docs" action={editDocs} />
          <div className="text-sm">
            <MarkdownRenderer size="compact">{node?.docs ?? ""}</MarkdownRenderer>
          </div>
        </div>
      ) : text ? (
        <div className="space-y-1">
          <LabelRow label={text[0].replace(/_/g, " ")} action={editDocs} />
          <div className="text-sm">
            <MarkdownRenderer size="compact">{text[1]}</MarkdownRenderer>
          </div>
        </div>
      ) : (
        node &&
        !isNew &&
        !loading && (
          <div className="flex items-center gap-3 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
            <p className="flex-1">Nothing written on this node yet — an agent that reads it learns nothing.</p>
            {editDocs}
          </div>
        )
      )}

      {node && graph && (
        <div className="space-y-3">
          <NodeChips label="Parents" ids={parentsOf(graph, id)} graph={graph} />
          <NodeChips label="Children" ids={childrenOf(graph, id)} graph={graph} />
        </div>
      )}

      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {fields.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono" title={display(v)}>
                {display(v)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {error ? (
        <p className="text-xs text-muted-foreground">{error.message}</p>
      ) : loading ? (
        <p className="text-xs text-muted-foreground">Loading connections…</p>
      ) : (
        data && <Connections refId={id} groups={groups} />
      )}

      {conceptRef && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            data-testid="graph-workbench-delete-concept"
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete concept?</AlertDialogTitle>
                <AlertDialogDescription>
                  &quot;{name}&quot; and its links will be removed from the graph.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    remove.mutate(conceptRef);
                  }}
                  disabled={remove.isPending}
                  data-testid="graph-workbench-confirm-delete"
                >
                  {remove.isPending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {node && !isNew && (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs"
          data-testid="graph-workbench-audit"
        >
          <dt className="text-muted-foreground">Read</dt>
          <dd className="tabular-nums">
            {node.reads === 0 ? "Never" : `${node.reads.toLocaleString()} times by runs and sessions`}
          </dd>
          <dt className="text-muted-foreground">Approved by</dt>
          <dd>{node.approvers.length ? node.approvers.join(", ") : "No one"}</dd>
          {node.repo && (
            <>
              <dt className="text-muted-foreground">Repo</dt>
              <dd className="font-mono">{node.repo}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
