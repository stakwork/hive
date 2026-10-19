"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { strutArtifactReaderUrl } from "@/lib/strut-jobs";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { PanelToolbar } from "../chrome";
import { useChatOrgLogin } from "../useArtifactPanel";
import {
  addTap,
  clockOf,
  msLeft,
  overlayCells,
  parseCaptchaManifest,
  removeTap,
  tapFromPointer,
  tappedCells,
  tileSummary,
  toggleCellTap,
  type CaptchaManifest,
  type Tap,
} from "../captchaTaps";

/**
 * A captcha a strut job hit and cannot solve: the cropped image, its
 * instruction and the clock, and the way to answer — tap tiles (or dots) on
 * the image, or type text. The answer goes to the job's captcha route and
 * becomes the job's next turn. Only the person who started the job can
 * answer; everyone else sees the image alone.
 */

type Access = { status: "loading" } | { status: "ready"; owner: boolean };
type Sent = { status: "idle" } | { status: "busy" } | { status: "sent" } | { status: "failed"; error: string };

const ACCENT = "#0071e3";
/** The accent at ~0.28 opacity, over a tapped tile. */
const ACCENT_FILL = "rgba(0, 113, 227, 0.28)";
const MAX_ROUNDS = 5;

function captchaUrl(githubLogin: string, jobId: string): string {
  return `/api/orgs/${encodeURIComponent(githubLogin)}/strut/jobs/${encodeURIComponent(jobId)}/captcha`;
}

export function CaptchaPanel({ content, jobId }: ArtifactViewerProps<"captcha">) {
  const githubLogin = useChatOrgLogin();
  const { swarmId, key } = content.manifest;
  const [manifest, setManifest] = useState<CaptchaManifest | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(strutArtifactReaderUrl(githubLogin, swarmId, key), { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw) => {
        const parsed = parseCaptchaManifest(raw, key);
        if (cancelled) return;
        if (parsed) setManifest(parsed);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [githubLogin, swarmId, key]);

  const site = manifest?.site ?? content.site;
  const [access, setAccess] = useState<Access>({ status: "loading" });
  useEffect(() => {
    // No job to answer to: the image alone.
    if (!jobId) {
      setAccess({ status: "ready", owner: false });
      return;
    }
    let cancelled = false;
    fetch(captchaUrl(githubLogin, jobId), { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((out: { owner?: boolean }) => !cancelled && setAccess({ status: "ready", owner: out.owner === true }))
      .catch(() => !cancelled && setAccess({ status: "ready", owner: false }));
    return () => {
      cancelled = true;
    };
  }, [githubLogin, jobId]);

  const [now, setNow] = useState(() => Date.now());
  const expiresAt = manifest?.expiresAt ?? content.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const [taps, setTaps] = useState<Tap[]>([]);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<Sent>({ status: "idle" });
  const imgRef = useRef<HTMLImageElement>(null);

  const grid = manifest?.grid ?? content.grid;
  const mode = manifest?.mode ?? content.mode ?? "either";
  const round = manifest?.round ?? content.round ?? 1;
  const maxRounds = manifest?.maxRounds ?? content.maxRounds ?? MAX_ROUNDS;
  const instruction = manifest?.instruction ?? content.instruction;
  const state = manifest?.state ?? content.state;
  const left = msLeft(expiresAt, now);
  const expired = state === "expired" || (left !== null && left <= 0);
  const waiting = (state === undefined || state === "waiting") && !expired;
  const imageKey = manifest?.imageKey ?? content.image?.key;
  const imageSwarm = content.image?.swarmId ?? swarmId;

  const canAnswer = access.status === "ready" && access.owner && !!jobId && !!site;
  const done = sent.status === "sent" || state === "sent" || state === "solved";

  const submit = async (body: Record<string, unknown>) => {
    if (!jobId || !site) return;
    setSent({ status: "busy" });
    try {
      const res = await fetch(captchaUrl(githubLogin, jobId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round, site, ...body }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 202) return setSent({ status: "sent" });
      if (res.status === 403) {
        setAccess((a) => (a.status === "ready" ? { ...a, owner: false } : a));
        return setSent({ status: "idle" });
      }
      setSent({ status: "failed", error: res.status === 409 ? "The job is still working — try again in a minute." : (out.error ?? `HTTP ${res.status}`) });
    } catch (err) {
      setSent({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const img = imgRef.current;
    if (!img || !canAnswer || !waiting || done || mode === "text") return;
    const tap = tapFromPointer(e.clientX, e.clientY, img.getBoundingClientRect());
    setTaps((t) => (grid ? toggleCellTap(t, tap, grid) : addTap(t, tap)));
  };

  const showTaps = mode !== "text";
  const showText = mode !== "tap";
  const cells = grid ? tappedCells(taps, grid) : null;

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <ShieldQuestion className="h-4 w-4" aria-hidden="true" />
        <span data-testid="captcha-round">Round {round} of {maxRounds}</span>
        {site && <span className="truncate text-muted-foreground">{site}</span>}
        {left !== null && !expired && waiting && (
          <span className="ml-auto tabular-nums text-muted-foreground" data-testid="captcha-left">
            {clockOf(left)} left
          </span>
        )}
      </PanelToolbar>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {failed && <p className="text-xs text-muted-foreground">The captcha could not be loaded.</p>}
        {instruction && <p data-testid="captcha-instruction">{instruction}</p>}
        {access.status === "ready" && imageKey && (
          <div className="relative inline-block max-w-full select-none" onPointerUp={onPointerUp} data-testid="captcha-area">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={strutArtifactReaderUrl(githubLogin, imageSwarm, imageKey)}
              alt={instruction ?? "Captcha"}
              draggable={false}
              className="block max-h-[60vh] max-w-full rounded border bg-muted/30"
            />
            {canAnswer && waiting && !done && showTaps && grid && cells && (
              <div className="pointer-events-none absolute inset-0" data-testid="captcha-overlay">
                {overlayCells(grid).map((c) => (
                  <div
                    key={c.index}
                    data-testid={cells.has(c.index) ? "captcha-cell-tapped" : "captcha-cell"}
                    className="absolute border border-white/40"
                    style={{ left: `${c.left}%`, top: `${c.top}%`, width: `${c.width}%`, height: `${c.height}%`, ...(cells.has(c.index) ? { backgroundColor: ACCENT_FILL } : {}) }}
                  >
                    {cells.has(c.index) && (
                      <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ backgroundColor: ACCENT }}>
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canAnswer && waiting && !done && showTaps && !grid &&
              taps.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid="captcha-dot"
                  aria-label={`Remove tap ${i + 1}`}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={() => setTaps((all) => removeTap(all, i))}
                  className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ left: `${t.nx * 100}%`, top: `${t.ny * 100}%`, backgroundColor: ACCENT }}
                >
                  {i + 1}
                </button>
              ))}
          </div>
        )}

        {expired && <p data-testid="captcha-expired" className="text-xs text-amber-700 dark:text-amber-300">This captcha expired — nothing to tap.</p>}
        {done && <p data-testid="captcha-sent" className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Sent</p>}
        {state === "failed" && <p className="text-xs text-rose-700 dark:text-rose-300">The job could not get past it.</p>}
        {!canAnswer && access.status === "ready" && waiting && !done && (
          <p className="text-xs text-muted-foreground">Only the person who started this job can answer it.</p>
        )}

        {canAnswer && waiting && !done && (
          <div className="space-y-2">
            {showTaps && grid && <p data-testid="captcha-summary" className="text-xs text-muted-foreground">{tileSummary(taps, grid)}</p>}
            {showTaps && !grid && <p className="text-xs text-muted-foreground">{taps.length} {taps.length === 1 ? "tap" : "taps"}</p>}
            {showText && (
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                data-testid="captcha-text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Type what the image shows"
                className="w-full rounded-md border bg-background px-2 py-1 text-xs"
              />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {sent.status === "failed" && <span className="mr-auto text-xs text-amber-600 dark:text-amber-400">{sent.error}</span>}
              {showTaps && (
                <button
                  type="button"
                  disabled={taps.length === 0 || sent.status === "busy"}
                  onClick={() => submit({ taps })}
                  className={cn("rounded-md border bg-background px-2 py-0.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60")}
                >
                  Submit taps
                </button>
              )}
              {showText && (
                <button
                  type="button"
                  disabled={text.length === 0 || sent.status === "busy"}
                  onClick={() => submit({ text })}
                  className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
                >
                  Send
                </button>
              )}
              <button
                type="button"
                disabled={sent.status === "busy"}
                onClick={() => submit({ skip: true })}
                className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
