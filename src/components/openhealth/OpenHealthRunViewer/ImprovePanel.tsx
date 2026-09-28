"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type {
  OpenHealthConceptProposal,
  OpenHealthImprovement,
  OpenHealthImproveResponse,
  OpenHealthOutcome,
} from "@/types/openhealth";
import { formatDuration, formatWhen } from "../format";

/** Poll cadence while an improve run is in flight. */
const POLL_MS = 10_000;

const OUTCOME_LABEL: Record<OpenHealthOutcome, string> = {
  running: "running",
  succeeded: "finished",
  failed: "failed",
  cancelled: "cancelled",
};

function WriteBadge({ proposal }: { proposal: OpenHealthConceptProposal }) {
  if (proposal.write === "created") return <Badge>Added to the graph</Badge>;
  if (proposal.write === "existed") return <Badge variant="secondary">Already in the graph</Badge>;
  if (proposal.write === "failed") return <Badge variant="destructive">Not written</Badge>;
  // The run reports no write per amendment.
  if (proposal.action === "amend") return null;
  return <Badge variant="outline">Proposed</Badge>;
}

function Proposal({ proposal }: { proposal: OpenHealthConceptProposal }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <li data-testid="openhealth-improve-proposal">
        <CollapsibleTrigger className="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-muted/40">
          <ChevronRight
            className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{proposal.name}</span>
            {proposal.parent && <span className="text-muted-foreground"> under {proposal.parent}</span>}
            {proposal.description && (
              <span className="block text-xs text-muted-foreground">{proposal.description}</span>
            )}
          </span>
          <WriteBadge proposal={proposal} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 px-4 pb-4 pl-10">
          {proposal.writeError && <p className="text-destructive">{proposal.writeError}</p>}
          {proposal.addresses.length > 0 && (
            <p>
              <span className="text-muted-foreground">Fixes </span>
              {proposal.addresses.join(", ")}
            </p>
          )}
          {proposal.rationale && (
            <p>
              <span className="text-muted-foreground">Why </span>
              {proposal.rationale}
            </p>
          )}
          {proposal.docs && (
            <div className="max-h-[480px] overflow-auto rounded-md border bg-background p-3">
              <MarkdownRenderer size="compact">{proposal.docs}</MarkdownRenderer>
            </div>
          )}
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

function Group({
  title,
  hint,
  count,
  testId,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  testId: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="rounded-lg border" data-testid={testId}>
      <div className="border-b px-4 py-2">
        <p className="text-sm font-semibold">
          {title} <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ul className="divide-y text-sm">{children}</ul>
    </div>
  );
}

function Result({ improvement }: { improvement: OpenHealthImprovement }) {
  if (improvement.outcome === "running") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="openhealth-improve-running">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading the run&apos;s scoring errors and writing Concepts. This takes a few minutes.
      </p>
    );
  }
  if (improvement.outcome === "cancelled") {
    return <p className="text-sm text-muted-foreground">The improve run was cancelled.</p>;
  }
  if (improvement.outcome === "failed") {
    return (
      <p className="text-sm text-destructive" data-testid="openhealth-improve-failure">
        {improvement.error}
      </p>
    );
  }

  const creates = improvement.proposals.filter((p) => p.action === "create");
  const amends = improvement.proposals.filter((p) => p.action === "amend");
  const nothing =
    improvement.proposals.length === 0 && improvement.rejected.length === 0 && improvement.notAddressed.length === 0;
  return (
    <div className="space-y-3" data-testid="openhealth-improve-result">
      <p className="text-xs text-muted-foreground">
        {formatWhen(improvement.createdAt)} · {formatDuration(improvement.durationMs)}
        {improvement.errorCount !== null && ` · ${improvement.errorCount} scoring errors read`}
      </p>
      {improvement.summary && <p className="whitespace-pre-wrap text-sm">{improvement.summary}</p>}
      {nothing && <p className="text-sm text-muted-foreground">The run proposed nothing.</p>}
      <Group
        title="New Concepts"
        hint={
          improvement.applied
            ? "Written under their parent Concept. Drafts until a later run shows the errors are gone."
            : "Proposed only: this run did not write to the graph."
        }
        count={creates.length}
        testId="openhealth-improve-creates"
      >
        {creates.map((proposal) => (
          <Proposal key={proposal.name} proposal={proposal} />
        ))}
      </Group>
      <Group
        title="Amendments"
        hint={
          improvement.applied
            ? "Replacement docs for existing Concepts"
            : "Proposed only: this run did not write to the graph."
        }
        count={amends.length}
        testId="openhealth-improve-amends"
      >
        {amends.map((proposal) => (
          <Proposal key={proposal.name} proposal={proposal} />
        ))}
      </Group>
      <Group
        title="Refused"
        hint="Proposals that did not pass the workflow's checks"
        count={improvement.rejected.length}
        testId="openhealth-improve-rejected"
      >
        {improvement.rejected.map((proposal, index) => (
          <li key={`${proposal.name}-${index}`} className="px-4 py-2">
            <span className="font-medium">{proposal.name}</span>
            <span className="block text-xs text-muted-foreground">{proposal.reasons.join("; ")}</span>
          </li>
        ))}
      </Group>
      <Group
        title="Left alone"
        hint="Scoring errors no Concept would fix"
        count={improvement.notAddressed.length}
        testId="openhealth-improve-not-addressed"
      >
        {improvement.notAddressed.map((entry) => (
          <li key={entry.error} className="px-4 py-2">
            <span className="font-mono text-xs">{entry.error}</span>
            <span className="block text-xs text-muted-foreground">{entry.reason}</span>
          </li>
        ))}
      </Group>
    </div>
  );
}

/**
 * Improve a scored run: one click launches `openhealth-improve` over it, and
 * the Concepts it wrote are shown here. `endpoint` is the run's improve route.
 */
export function ImprovePanel({ endpoint }: { endpoint: string }) {
  const { canWrite } = useWorkspaceAccess();
  const [improvements, setImprovements] = useState<OpenHealthImprovement[]>([]);
  const [shownId, setShownId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) return;
      setImprovements(((await response.json()) as OpenHealthImproveResponse).improvements);
    } catch {
      // The button still works; the next poll or launch reads the list again.
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = improvements.some((i) => i.outcome === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { improveId?: string; error?: string };
      if (!response.ok || !body.improveId) throw new Error(body.error || "Could not start the improve run");
      setShownId(body.improveId);
      await load();
    } catch (e) {
      toast.error("Could not start the improve run", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [endpoint, load]);

  const shown = improvements.find((i) => i.id === shownId) ?? improvements[0];
  const busy = starting || running;

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3" data-testid="openhealth-improve">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Improve</p>
          <p className="text-xs text-muted-foreground">
            Turn this run&apos;s scoring errors into Concepts under Medicine: new ones and amendments to existing ones,
            written to the graph.
          </p>
        </div>
        {improvements.length > 1 && shown && (
          <Select value={shown.id} onValueChange={setShownId}>
            <SelectTrigger className="w-64" data-testid="openhealth-improve-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {improvements.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {formatWhen(i.createdAt)} · {OUTCOME_LABEL[i.outcome]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          disabled={!canWrite || busy}
          onClick={() => void start()}
          data-testid="openhealth-improve-start"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {running ? "Improving…" : "Improve"}
        </Button>
      </div>
      {shown && <Result improvement={shown} />}
    </div>
  );
}
