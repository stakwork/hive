"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Artifact, VerifyContent, VerifyOutcome } from "@/lib/chat";
import {
  ShieldCheck,
  XCircle,
  HelpCircle,
  ChevronDown,
  Camera,
  Globe,
  Terminal,
  Clock,
  FileText,
  StickyNote,
  Network,
  Bug,
  Database,
} from "lucide-react";

type BadgeVariant = "default" | "destructive" | "secondary";

const OUTCOME: Record<
  VerifyOutcome,
  { icon: typeof ShieldCheck; label: string; color: string; bg: string; border: string; badge: BadgeVariant }
> = {
  works: { icon: ShieldCheck, label: "Verified", color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/30", badge: "default" },
  broken: { icon: XCircle, label: "Broken", color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30", badge: "destructive" },
  unknown: { icon: HelpCircle, label: "Inconclusive", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30", badge: "secondary" },
};

const KIND_ICON: Record<VerifyContent["evidence"][number]["kind"], typeof Camera> = {
  screenshot: Camera,
  http: Globe,
  log: Terminal,
  timing: Clock,
  dom: FileText,
  network: Network,
  console: Bug,
  db: Database,
  note: StickyNote,
};

export function isAuditVerdict(content: unknown): content is VerifyContent {
  return (
    !!content &&
    typeof content === "object" &&
    "overall" in content &&
    "claims" in content
  );
}

export function VerdictPill({ artifact }: { artifact: Artifact }) {
  const content = artifact.content as VerifyContent;
  const [open, setOpen] = useState(false);
  const outcome = OUTCOME[content.overall] ?? OUTCOME.unknown;
  const Icon = outcome.icon;
  const evidenceCount = content.evidence?.length ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-full border ${outcome.border} bg-card px-2.5 py-0.5 text-[11px] font-medium hover:bg-muted/60 transition-colors`}
        title="View audit details"
      >
        <Icon className={`size-3.5 ${outcome.color}`} />
        <span className={outcome.color}>{outcome.label}</span>
        {evidenceCount > 0 && <span className="text-muted-foreground">· {evidenceCount} evidence</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className={`size-5 ${outcome.color}`} />
              Audit — {outcome.label}
            </DialogTitle>
          </DialogHeader>
          <VerdictArtifact artifact={artifact} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VerdictArtifact({ artifact }: { artifact: Artifact }) {
  const content = artifact.content as VerifyContent;
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const outcome = OUTCOME[content.overall] ?? OUTCOME.unknown;
  const Icon = outcome.icon;
  const claims = content.claims ?? [];
  const evidence = content.evidence ?? [];
  const observations = content.observations ?? [];

  const tally: Record<VerifyOutcome, number> = { works: 0, broken: 0, unknown: 0 };
  claims.forEach((c) => {
    tally[c.verdict] = (tally[c.verdict] ?? 0) + 1;
  });

  return (
    <Card className={`border ${outcome.border} overflow-hidden gap-0 py-0`}>
      <div className={`flex items-start gap-3 p-3 ${outcome.bg}`}>
        <div className={`mt-0.5 ${outcome.color}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${outcome.color}`}>{outcome.label}</span>
            <span className="text-xs text-muted-foreground">Audit</span>
          </div>
          <p className="mt-0.5 text-sm text-foreground/90 break-words">{content.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tally.works > 0 && <Badge variant="default">{tally.works} works</Badge>}
            {tally.broken > 0 && <Badge variant="destructive">{tally.broken} broken</Badge>}
            {tally.unknown > 0 && <Badge variant="secondary">{tally.unknown} unknown</Badge>}
            {evidence.length > 0 && (
              <span className="text-xs text-muted-foreground">· {evidence.length} evidence</span>
            )}
          </div>
        </div>
      </div>

      {claims.length > 0 && (
        <Collapsible open={claimsOpen} onOpenChange={setClaimsOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between border-t px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50">
            <span>
              {claimsOpen ? "Hide" : "Show"} {claims.length} claim{claims.length === 1 ? "" : "s"}
            </span>
            <ChevronDown className={`size-4 transition-transform ${claimsOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y">
              {claims.map((c, i) => {
                const cfg = OUTCOME[c.verdict] ?? OUTCOME.unknown;
                return (
                  <div key={i} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium break-words">{c.claim}</span>
                      <Badge variant={cfg.badge} className="shrink-0">
                        {c.verdict}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground break-words">{c.reasoning}</p>
                    {c.proof?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.proof.map((p) => (
                          <Badge key={p} variant="outline" className="font-mono text-[10px]">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {observations.length > 0 && (
              <div className="border-t px-3 py-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Observations</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {observations.map((o, i) => (
                    <li key={i} className="text-xs text-muted-foreground break-words">
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {evidence.length > 0 && (
        <div className="border-t px-3 py-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDetailsOpen(true)}>
            View full audit · {evidence.length} evidence
          </Button>
        </div>
      )}

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className={`size-5 ${outcome.color}`} />
              Audit — {outcome.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {evidence.map((e) => {
              const KindIcon = KIND_ICON[e.kind] ?? FileText;
              return (
                <div key={e.id} className="rounded-md border p-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <KindIcon className="size-3.5 shrink-0" />
                    <span className="font-mono">{e.id}</span>
                    <span className="uppercase">{e.kind}</span>
                    <span className="truncate">{e.summary}</span>
                  </div>
                  {e.kind === "screenshot" ? (
                    <img
                      src={`data:image/png;base64,${e.data}`}
                      alt={e.summary}
                      className="mt-2 max-w-full rounded border"
                    />
                  ) : e.data ? (
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs">
                      {e.data}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
