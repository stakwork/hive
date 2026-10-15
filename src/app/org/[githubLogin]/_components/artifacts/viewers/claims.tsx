"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { parseStrutArtifactKey, strutArtifactReaderUrl } from "@/lib/strut-jobs";
import {
  parseArtifactContent,
  type ArtifactContents,
  type ArtifactViewerProps,
  type ClaimCheckOutcome,
  type JobClaim,
} from "../../../_state/canvasChatArtifacts";
import { PanelToolbar } from "../chrome";
import { useChatOrgLogin } from "../useArtifactPanel";

/**
 * A strut job's claims card (strut plans/job-claims.md §7;
 * `services/strut-jobs/claims.ts`): what the work must deliver and whether
 * it does, as of a turn. Each claim with its status, who stated it, the
 * latest verdict and the turn it is about, the screenshot it pointed at
 * (a job file, read through Hive's reader route — never the swarm's own
 * link), its checks with how each did on the latest pass, and the open
 * slots first, as to-dos. The panel's actions — Verify, Supports / Refutes,
 * a new claim — go to the job's claims route; each publishes the card's
 * next version, shown here at once.
 */

type ClaimsContent = ArtifactContents["claims"];

const STATUS_CLASSES: Record<JobClaim["status"], string> = {
  supported: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  refuted: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
  stale: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
  unknown: "bg-muted text-muted-foreground ring-border",
};

const STATUS_HINT: Record<JobClaim["status"], string> = {
  supported: "The newest verdict, on the newest turn, supports it.",
  refuted: "A verdict on the newest turn refutes it.",
  stale: "The verdict is about an earlier turn: verify to check the newest one.",
  unknown: "Never verified.",
};

/** "2/3 supported · 1 refuted" — the card's caption. */
export function claimsFact(content: ClaimsContent): string | null {
  const { claims } = content;
  if (claims.length === 0) return null;
  const supported = claims.filter((c) => c.status === "supported").length;
  const refuted = claims.filter((c) => c.status === "refuted").length;
  return `${supported}/${claims.length} supported${refuted ? ` · ${refuted} refuted` : ""}`;
}

/** Which turn a verdict is about, as a person reads it. */
export function verifiedOn(content: Pick<ClaimsContent, "turn" | "turns">, about: string | undefined): string | null {
  if (!about) return null;
  const n = content.turns?.[about];
  if (about === content.turn) return n ? `this turn (turn ${n})` : "this turn";
  return n ? `turn ${n}` : "an earlier turn";
}

/** How a check did on the latest pass, in words. */
export function outcomeWords(v: ClaimCheckOutcome | undefined): string | null {
  if (!v) return null;
  if ("ran" in v) return "ran";
  if ("pending" in v) return "pending";
  if ("planned" in v) return "waiting on a person";
  switch (v.skipped) {
    case "superseded":
      return "superseded — a newer turn";
    case "cannot-launch":
      return v.reason ? `couldn't run: ${v.reason}` : "couldn't run";
    case "budget":
      return "skipped: over the verify budget";
    case "policy":
      return "not due";
    default:
      return v.reason ? `skipped (${v.skipped}): ${v.reason}` : `skipped (${v.skipped})`;
  }
}

const speakerWords = (speaker: string | undefined): string | null =>
  speaker === "ai" ? "the job's agent" : speaker === "person" ? "a person" : speaker ?? null;

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/** Where a verdict's locator is shown: a job file through the reader route (an image is drawn), an endpoint as a link. */
export function locatorView(
  githubLogin: string,
  content: Pick<ClaimsContent, "swarmId">,
  locator: { url?: string; file?: string } | undefined,
): { image: string } | { file: string; name: string } | { link: string } | null {
  const url = locator?.url;
  if (!url) return null;
  if (parseStrutArtifactKey(url)) {
    const reader = strutArtifactReaderUrl(githubLogin, content.swarmId, url);
    return IMAGE.test(url) ? { image: reader } : { file: reader, name: url.split("/").pop() ?? url };
  }
  return /^https?:\/\//i.test(url) ? { link: url } : null;
}

function StatusPill({ status }: { status: JobClaim["status"] }) {
  return (
    <span
      title={STATUS_HINT[status]}
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset", STATUS_CLASSES[status])}
    >
      {status}
    </span>
  );
}

// ─── The card ─────────────────────────────────────────────────────────────

const INLINE_LIMIT = 4;

export function ClaimsInline({ content }: ArtifactViewerProps<"claims">) {
  const shown = content.claims.slice(0, INLINE_LIMIT);
  const todos = content.claims.reduce((n, c) => n + c.slots.length, 0);
  return (
    <div className="space-y-1.5 px-3 py-2.5 text-xs">
      {shown.map((c) => (
        <div key={c.id} className="flex items-start gap-2">
          <StatusPill status={c.status} />
          <span className="min-w-0 flex-1 truncate text-foreground">{c.text}</span>
        </div>
      ))}
      {content.claims.length > INLINE_LIMIT && <p className="text-muted-foreground">+{content.claims.length - INLINE_LIMIT} more</p>}
      {content.claims.length === 0 && <p className="text-muted-foreground">No claims yet.</p>}
      {todos > 0 && <p className="text-amber-700 dark:text-amber-300">{todos === 1 ? "1 check is" : `${todos} checks are`} waiting on you</p>}
    </div>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────

type ActionState = { status: "idle" } | { status: "busy"; what: string } | { status: "done"; note: string } | { status: "failed"; error: string };

/** One POST to the job's claims route; the new card's content when it published one. */
async function act(githubLogin: string, job: string, body: Record<string, unknown>): Promise<{ note: string; content?: ClaimsContent }> {
  const res = await fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/strut/jobs/${encodeURIComponent(job)}/claims`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string; card?: { source?: { content?: unknown } } | null; summary?: string; runId?: string; recorded?: boolean };
  if (res.status === 202) return { note: "Sent to the job as its next turn." };
  if (!res.ok) throw new Error(out.recorded ? `Recorded, but ${out.error ?? "the turn could not start"}` : (out.error ?? `HTTP ${res.status}`));
  const content = parseArtifactContent("claims", out.card?.source?.content) ?? undefined;
  return { note: out.summary ? `Verified: ${out.summary}.` : "Done.", ...(content ? { content } : {}) };
}

export function ClaimsPanel({ content: given }: ArtifactViewerProps<"claims">) {
  const githubLogin = useChatOrgLogin();
  // The version an action just published, until the conversation brings it.
  const [published, setPublished] = useState<ClaimsContent | null>(null);
  useEffect(() => setPublished(null), [given]);
  const content = published ?? given;
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ text: "", description: "" });
  const busy = state.status === "busy";

  const run = async (what: string, body: Record<string, unknown>, after?: () => void) => {
    setState({ status: "busy", what });
    try {
      const out = await act(githubLogin, content.job, body);
      if (out.content) setPublished(out.content);
      after?.();
      setState({ status: "done", note: out.note });
    } catch (err) {
      setState({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  const turnNo = content.turns?.[content.turn];
  const todos = content.claims.flatMap((claim) => claim.slots.map((slot) => ({ claim, slot })));

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <span className="text-muted-foreground">As of {turnNo ? `turn ${turnNo}` : "the turn"}</span>
        <span className="ml-auto flex items-center gap-2">
          {state.status === "busy" && <span className="text-muted-foreground">{state.what}…</span>}
          {state.status === "done" && <span data-testid="claims-note">{state.note}</span>}
          {state.status === "failed" && <span className="text-amber-600 dark:text-amber-400">{state.error}</span>}
          <button
            type="button"
            data-testid="claims-verify"
            disabled={busy}
            onClick={() => run("Verifying", { action: "verify" })}
            title="Run every check on every claim against the job's newest turn"
            className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Verify
          </button>
        </span>
      </PanelToolbar>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {todos.map(({ claim, slot }) => (
          <div key={slot.evidence} data-testid="claims-todo" className="space-y-2 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Needs a look — {claim.text}</p>
            <p className="whitespace-pre-wrap text-xs">{slot.question ?? claim.checks.find((k) => k.id === slot.check)?.description ?? claim.checks.find((k) => k.id === slot.check)?.name ?? "An external check is waiting on you."}</p>
            <textarea
              rows={2}
              value={notes[slot.evidence] ?? ""}
              placeholder="What did you see? A refutation with a note goes to the job as its next turn."
              onChange={(e) => setNotes((n) => ({ ...n, [slot.evidence]: e.target.value }))}
              className="w-full rounded-md border bg-background px-2 py-1 text-xs"
            />
            <div className="flex justify-end gap-2">
              {([true, false] as const).map((supports) => (
                <button
                  key={String(supports)}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      supports ? "Recording" : "Refuting",
                      { action: "answer", claimId: claim.id, slot: slot.evidence, runId: slot.runId ?? content.turn, supports, note: notes[slot.evidence] ?? "" },
                      () => setNotes((n) => ({ ...n, [slot.evidence]: "" })),
                    )
                  }
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60",
                    supports ? "border-emerald-600/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" : "border-rose-600/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300",
                  )}
                >
                  {supports ? "Supports" : "Refutes"}
                </button>
              ))}
            </div>
          </div>
        ))}

        {content.claims.length === 0 && <p className="text-xs text-muted-foreground">No claims yet — nothing says what this job must deliver.</p>}

        {content.claims.map((claim) => {
          const on = verifiedOn(content, claim.latest?.about);
          const where = locatorView(githubLogin, content, claim.latest?.locator);
          return (
            <div key={claim.id} data-testid="claims-claim" className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill status={claim.status} />
                {claim.assertedOnly && <span className="text-amber-700 dark:text-amber-300">asserted only</span>}
                {claim.unverified > 0 && claim.status !== "unknown" && <span className="text-muted-foreground">{claim.unverified} unverified</span>}
                {speakerWords(claim.speaker) && <span className="text-muted-foreground">by {speakerWords(claim.speaker)}</span>}
              </div>
              <p>{claim.text}</p>
              {claim.latest && (
                <div className="space-y-1.5 border-l-2 pl-2 text-xs text-muted-foreground">
                  <p>
                    {claim.latest.mode && <span className="mr-1.5 font-semibold uppercase tracking-wide">{claim.latest.mode}</span>}
                    <span className="font-mono text-foreground">{claim.latest.content}</span>
                  </p>
                  {on && <p>verified on {on}{claim.latest.checkVersion ? ` · ${claim.latest.checkVersion}` : ""}</p>}
                  {where && "image" in where && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={where.image} alt={`What "${claim.text}" was checked against`} loading="lazy" className="max-h-64 w-full rounded border bg-muted/30 object-contain" />
                  )}
                  {where && "file" in where && (
                    <a href={where.file} target="_blank" rel="noreferrer" className="underline">
                      {where.name}
                    </a>
                  )}
                  {where && "link" in where && (
                    <a href={where.link} target="_blank" rel="noreferrer" className="underline">
                      {where.link}
                    </a>
                  )}
                </div>
              )}
              {claim.checks.length > 0 && (
                <ul className="space-y-0.5 text-xs">
                  {claim.checks.map((k) => (
                    <li key={k.id} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{k.name}</span>
                      <span className="text-muted-foreground">{k.external ? "a person" : "a tool"}</span>
                      {outcomeWords(k.lastVerify) && <span data-testid="claims-outcome">{outcomeWords(k.lastVerify)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-semibold">New claim</p>
          <input
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            placeholder="What must the work deliver? One sentence."
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          <textarea
            rows={2}
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="What to look at to tell — you answer it here; the job may add its own check."
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !draft.text.trim() || !draft.description.trim()}
              onClick={() => run("Adding", { action: "claim", text: draft.text.trim(), description: draft.description.trim() }, () => setDraft({ text: "", description: "" }))}
              className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              Add claim
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
