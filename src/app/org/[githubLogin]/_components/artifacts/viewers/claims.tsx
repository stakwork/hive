"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { parseStrutArtifactKey, strutArtifactReaderUrl } from "@/lib/strut-jobs";
import {
  claimNeedsLook,
  parseArtifactContent,
  type ArtifactContents,
  type ArtifactViewerProps,
  type ClaimCheckOutcome,
  type JobClaim,
} from "../../../_state/canvasChatArtifacts";
import { PanelToolbar } from "../chrome";
import { useChatOrgLogin } from "../useArtifactPanel";

/**
 * A strut job's claims (strut plans/job-claims.md §7;
 * `services/strut-jobs/claims.ts`): what the work must deliver and whether
 * it does, as of a turn. The chat card is the summary alone; the panel has
 * each claim once — its status, who stated it, the latest verdict and the
 * turn it is about, the screenshot it pointed at (a job file, read through
 * Hive's reader route — never the swarm's own link), its tool checks with
 * how each did on the latest pass, and, when it waits on a person, what to
 * look at with Accept / Reject right there. Those waiting come first. The
 * panel's actions — Verify, Accept / Reject, a new claim — go to the job's
 * claims route; each publishes the card's next version, shown here at once.
 */

type ClaimsContent = ArtifactContents["claims"];

/** What a claim's pill says: its status, or that it waits on a person's look. */
type Pill = JobClaim["status"] | "needs a look";

const PILL_CLASSES: Record<Pill, string> = {
  supported: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  refuted: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
  stale: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
  unknown: "bg-muted text-muted-foreground ring-border",
  "needs a look": "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
};

const PILL_HINT: Record<Pill, string> = {
  supported: "The newest verdict, on the newest turn, supports it.",
  refuted: "A verdict on the newest turn refutes it.",
  stale: "The verdict is about an earlier turn: verify to check the newest one.",
  unknown: "Never verified.",
  "needs a look": "Only a person can tell: look, then accept or reject.",
};

const pillOf = (claim: JobClaim): Pill => (claimNeedsLook(claim) ? "needs a look" : claim.status);

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

function StatusPill({ pill }: { pill: Pill }) {
  return (
    <span
      title={PILL_HINT[pill]}
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset", PILL_CLASSES[pill])}
    >
      {pill}
    </span>
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
  // Those waiting on the person first; otherwise the ledger's order.
  const ordered = [...content.claims].sort((a, b) => Number(claimNeedsLook(b)) - Number(claimNeedsLook(a)));

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
        {content.claims.length === 0 && <p className="text-xs text-muted-foreground">No claims yet — nothing says what this job must deliver.</p>}

        {ordered.map((claim) => {
          const on = verifiedOn(content, claim.latest?.about);
          const where = locatorView(githubLogin, content, claim.latest?.locator);
          const look = claimNeedsLook(claim);
          // A check a slot stands for is the slot's question, not a line of its own.
          const tools = claim.checks.filter((k) => !claim.slots.some((slot) => slot.check === k.id));
          return (
            <div
              key={claim.id}
              data-testid="claims-claim"
              className={cn("space-y-2 rounded-lg border p-3", look && "border-dashed border-amber-500/50 bg-amber-500/5")}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill pill={pillOf(claim)} />
                {claim.assertedOnly && <span className="text-amber-700 dark:text-amber-300">asserted only</span>}
                {claim.unverified > 0 && claim.status !== "unknown" && !look && <span className="text-muted-foreground">{claim.unverified} unverified</span>}
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
              {tools.length > 0 && (
                <ul className="space-y-0.5 text-xs">
                  {tools.map((k) => (
                    <li key={k.id} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{k.name}</span>
                      <span className="text-muted-foreground">{k.external ? "a person" : "a tool"}</span>
                      {outcomeWords(k.lastVerify) && <span data-testid="claims-outcome">{outcomeWords(k.lastVerify)}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {claim.slots.map((slot) => {
                const check = claim.checks.find((k) => k.id === slot.check);
                return (
                  <div key={slot.evidence} data-testid="claims-todo" className="space-y-2">
                    <p className="whitespace-pre-wrap text-xs">{check?.description ?? slot.question ?? check?.name ?? "An external check is waiting on you."}</p>
                    <textarea
                      rows={2}
                      value={notes[slot.evidence] ?? ""}
                      placeholder="What did you see? A rejection with a note goes back to the job as its next turn."
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
                              supports ? "Accepting" : "Rejecting",
                              { action: "answer", claimId: claim.id, slot: slot.evidence, runId: slot.runId ?? content.turn, supports, note: notes[slot.evidence] ?? "" },
                              () => setNotes((n) => ({ ...n, [slot.evidence]: "" })),
                            )
                          }
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60",
                            supports ? "border-emerald-600/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" : "border-rose-600/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300",
                          )}
                        >
                          {supports ? "Accept" : "Reject"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
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
