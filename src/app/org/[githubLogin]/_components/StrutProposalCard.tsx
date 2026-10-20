"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Lightbulb, Loader2, RotateCcw, X } from "lucide-react";
import type { CanvasChatMessage } from "../_state/canvasChatStore";
import {
  strutProposalStepLabel,
  strutProposalToOutput,
  type StrutProposalRecord,
  type StrutProposalStatus,
} from "@/lib/strut-orchestrator";
import {
  GraphBatchTripletCreateMeta,
  GraphEdgeDeleteMeta,
  GraphNodeCreateMeta,
  GraphNodeMoveMeta,
  GraphTripletCreateMeta,
} from "./ProposalCard";

/**
 * A strut PROPOSAL (strut `specs/API.md` §12): a gated tool call an
 * orchestrator turn asked for — Jamie on strut — recorded on strut rather
 * than run, which the person accepts or rejects here. The row
 * (`source.kind: "proposal"`, `services/strut-runs/orchestrator-turn.ts`)
 * carries the brief; the card reads the RECORD live through hive's route
 * (`GET /api/orgs/<org>/strut/proposals/<id>?run=<StrutRun.id>`) and
 * decides at its `/decide`, which forwards to strut as the clicking user
 * and writes the result row. The body is drawn per `step`: hive's own
 * graph card bodies where the input has the same fields
 * (`strutProposalToOutput`), a key/value table for anything else. Status
 * is strut's, never derived from the transcript.
 */

export type StrutProposalSource = Extract<NonNullable<CanvasChatMessage["source"]>, { kind: "proposal" }>;

type Tone = "pending" | "ok" | "failed" | "muted";

const STATUS: Record<StrutProposalStatus, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting your decision", tone: "pending" },
  accepted: { label: "Accepted", tone: "ok" },
  applied: { label: "Applied", tone: "ok" },
  rejected: { label: "Rejected", tone: "muted" },
  failed: { label: "Failed", tone: "failed" },
};

const TONE_CLASSES: Record<Tone, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20",
  muted: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The input as key/value pairs — the body for a step hive has no card for. */
export function GenericInputBody({ input }: { input: unknown }) {
  const entries = isRecord(input) ? Object.entries(input) : [];
  if (entries.length === 0) {
    return (
      <div className="mt-1 text-[11px] text-muted-foreground">
        {input === undefined ? "No input." : JSON.stringify(input)}
      </div>
    );
  }
  return (
    <div
      data-testid="strut-proposal-generic-body"
      className="mt-1 rounded border border-border/50 bg-muted/30 px-2 py-1 text-[11px] font-mono space-y-0.5"
    >
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <span className="text-muted-foreground shrink-0">{k}:</span>
          <span className="break-all">{typeof v === "string" ? v : JSON.stringify(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** `graph/edit-node`: the node, the patch, the properties dropped. */
function EditNodeBody({ input }: { input: unknown }) {
  const data = isRecord(input) ? input : {};
  const patch = isRecord(data.node_data) ? Object.entries(data.node_data) : [];
  const deleted = Array.isArray(data.properties_to_be_deleted)
    ? data.properties_to_be_deleted.filter((p): p is string => typeof p === "string")
    : [];
  return (
    <div className="mt-0.5 space-y-0.5">
      <div className="text-[11px] font-mono text-muted-foreground/60">
        {typeof data.ref_id === "string" ? data.ref_id : ""}
      </div>
      {(patch.length > 0 || deleted.length > 0) && (
        <div className="mt-1 rounded border border-border/50 bg-muted/30 px-2 py-1 text-[11px] font-mono space-y-0.5">
          {patch.map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <span className="shrink-0 text-emerald-600 dark:text-emerald-400">+</span>
              <span className="text-muted-foreground shrink-0">{k}:</span>
              <span className="break-all whitespace-pre-wrap">{typeof v === "string" ? v : JSON.stringify(v)}</span>
            </div>
          ))}
          {deleted.map((k) => (
            <div key={`del-${k}`} className="flex gap-1">
              <span className="shrink-0 text-rose-600 dark:text-rose-400">−</span>
              <span className="text-muted-foreground line-through">{k}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** `graph/delete-node`: the node, and that every link touching it goes with it. */
function DeleteNodeBody({ input }: { input: unknown }) {
  const data = isRecord(input) ? input : {};
  return (
    <div className="mt-0.5 space-y-0.5">
      <div className="text-[11px] font-mono text-muted-foreground/60">
        {typeof data.ref_id === "string" ? data.ref_id : ""}
      </div>
      <div className="text-[11px] text-muted-foreground">
        deletes the node · permanently removes every link touching it
      </div>
    </div>
  );
}

/** The step's input, drawn per step. Exported for the test. */
export function StrutProposalBody({
  step,
  input,
  workspaceSlug,
}: {
  step: string;
  input: unknown;
  workspaceSlug?: string;
}) {
  const output = useMemo(() => strutProposalToOutput(step, input, workspaceSlug ?? ""), [step, input, workspaceSlug]);
  if (output) {
    switch (output.kind) {
      case "graphNodeCreate":
        return <GraphNodeCreateMeta proposal={output} />;
      case "graphTripletCreate":
        return <GraphTripletCreateMeta proposal={output} />;
      case "graphBatchTripletCreate":
        return <GraphBatchTripletCreateMeta proposal={output} />;
      case "graphEdgeDelete":
        return <GraphEdgeDeleteMeta proposal={output} />;
      case "graphNodeMove":
        return <GraphNodeMoveMeta proposal={output} />;
      default:
        break;
    }
  }
  if (step === "graph/edit-node") return <EditNodeBody input={input} />;
  if (step === "graph/delete-node") return <DeleteNodeBody input={input} />;
  return <GenericInputBody input={input} />;
}

interface StrutProposalCardProps {
  source: StrutProposalSource;
  githubLogin: string;
}

type Load =
  | { state: "loading" }
  | { state: "ready"; proposal: StrutProposalRecord }
  | { state: "error"; error: string };

export function StrutProposalCard({ source, githubLogin }: StrutProposalCardProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [deciding, setDeciding] = useState<"accept" | "reject" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const base = `/api/orgs/${encodeURIComponent(githubLogin)}/strut/proposals/${encodeURIComponent(source.proposalId)}`;

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    fetch(`${base}?run=${encodeURIComponent(source.runId)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { proposal?: StrutProposalRecord; error?: string } | null;
        if (cancelled) return;
        if (!res.ok || !body?.proposal) {
          setLoad({ state: "error", error: body?.error ?? `Could not read the proposal (${res.status}).` });
          return;
        }
        setLoad({ state: "ready", proposal: body.proposal });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ state: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [base, source.runId]);

  const decide = useCallback(
    async (action: "accept" | "reject") => {
      setDeciding(action);
      setNotice(null);
      try {
        const res = await fetch(`${base}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: source.runId, action }),
        });
        const body = (await res.json().catch(() => null)) as {
          proposal?: StrutProposalRecord | null;
          error?: string;
        } | null;
        if (body?.proposal) setLoad({ state: "ready", proposal: body.proposal });
        if (!res.ok) setNotice(body?.error ?? `Strut answered ${res.status}.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setDeciding(null);
      }
    },
    [base, source.runId],
  );

  const proposal = load.state === "ready" ? load.proposal : null;
  const status: StrutProposalStatus = proposal?.status ?? source.status;
  const title = proposal?.title ?? source.title;
  const step = proposal?.step ?? source.step;
  const rationale = proposal?.rationale ?? source.rationale;
  const look = STATUS[status] ?? STATUS.pending;
  const canDecide = load.state === "ready" && (status === "pending" || status === "failed");
  const dimmed = status === "rejected" || status === "applied";

  return (
    <div
      data-testid="strut-proposal-card"
      data-proposal-id={source.proposalId}
      data-status={status}
      className={`rounded-lg border bg-card text-card-foreground transition-opacity ${dimmed ? "opacity-60" : ""} ${status === "rejected" ? "line-through decoration-1" : ""}`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="mt-0.5 flex-shrink-0">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-medium">{strutProposalStepLabel(step)}</span>
            <span className="ml-auto normal-case tracking-normal">
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_CLASSES[look.tone]}`}
              >
                {look.label}
              </span>
            </span>
          </div>
          <div className="mt-0.5 break-words text-sm font-medium">{title}</div>
          {load.state === "loading" && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading the proposal…
            </div>
          )}
          {load.state === "error" && (
            <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{load.error}</div>
          )}
          {proposal && (
            <StrutProposalBody step={proposal.step} input={proposal.input} workspaceSlug={proposal.workspaceSlug} />
          )}
          {rationale && <p className="mt-1 text-[11px] italic text-muted-foreground">{rationale}</p>}
          {proposal?.decision?.reason && status === "rejected" && (
            <p className="mt-1 text-[11px] text-muted-foreground">Reason: {proposal.decision.reason}</p>
          )}
          {proposal?.result?.error && (
            <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300" data-testid="strut-proposal-error">
              {proposal.result.error}
            </p>
          )}
          {notice && <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">{notice}</p>}
          {canDecide && (
            <div className="mt-1 flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => void decide("accept")}
                disabled={deciding !== null}
                title={status === "failed" ? "Accept again" : "Approve"}
                aria-label={status === "failed" ? "Accept again" : "Approve"}
                className="flex h-6 items-center justify-center gap-1 rounded px-1 text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
              >
                {deciding === "accept" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : status === "failed" ? (
                  <RotateCcw className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {status === "failed" && <span className="text-[11px]">Accept again</span>}
              </button>
              {status === "pending" && (
                <button
                  type="button"
                  onClick={() => void decide("reject")}
                  disabled={deciding !== null}
                  title="Reject"
                  aria-label="Reject"
                  className="flex h-6 w-6 items-center justify-center rounded text-rose-600 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-400"
                >
                  {deciding === "reject" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
