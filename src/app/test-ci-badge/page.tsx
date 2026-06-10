"use client";
import {
  GitPullRequest, GitMerge, GitPullRequestClosed,
  ExternalLink, Loader2, CheckCircle2, XCircle, CircleDot,
} from "lucide-react";

type CIStatus = "pending" | "success" | "failure";
type PRStatus = "IN_PROGRESS" | "DONE" | "CANCELLED";

interface Props {
  url?: string;
  status: PRStatus;
  ciStatus?: CIStatus;
  ciSummary?: string;
}

const prLabel = (s: PRStatus) => s === "IN_PROGRESS" ? "Open" : s === "CANCELLED" ? "Closed" : "Merged";
const PRIcon = ({ status }: { status: PRStatus }) =>
  status === "DONE" ? <GitMerge className="w-3 h-3" /> :
  status === "CANCELLED" ? <GitPullRequestClosed className="w-3 h-3" /> :
  <GitPullRequest className="w-3 h-3" />;

const ciColors = {
  pending: { dot: "bg-yellow-400", text: "text-yellow-400", border: "border-yellow-500/30", bg: "bg-yellow-500/10" },
  success: { dot: "bg-emerald-400", text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10" },
  failure: { dot: "bg-red-400",     text: "text-red-400",     border: "border-red-500/30",     bg: "bg-red-500/10"     },
};
const ciLabel = (s: CIStatus) => s === "pending" ? "Checks running" : s === "success" ? "All checks passed" : "Checks failed";
const CIIcon = ({ status, className }: { status: CIStatus; className?: string }) =>
  status === "pending" ? <Loader2 className={`animate-spin ${className}`} /> :
  status === "success" ? <CheckCircle2 className={className} /> :
  <XCircle className={className} />;

/* ── VARIATION 1: Two connected pills (current) ─────────────────────────── */
function V1({ status, ciStatus, ciSummary, url = "#" }: Props) {
  const showCI = status === "IN_PROGRESS" && ciStatus;
  const c = ciStatus ? ciColors[ciStatus] : null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className="inline-flex items-center gap-0 cursor-pointer">
      <span className={`inline-flex items-center gap-1 h-5 px-2 text-[11px] font-medium
        ${showCI ? "rounded-l-full rounded-r-none border-r-0" : "rounded-full"}
        ${status === "IN_PROGRESS" ? "bg-[#238636] text-white border border-[#238636]/40" :
          status === "CANCELLED"   ? "bg-[#6e7681] text-white border border-[#6e7681]/40" :
                                     "bg-[#8957e5] text-white border border-[#8957e5]/40"}`}>
        <PRIcon status={status} />{prLabel(status)}<ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </span>
      {showCI && c && (
        <span title={ciSummary} className={`inline-flex items-center gap-1 h-5 px-1.5 text-[10px] font-medium
          rounded-r-full border ${c.border} ${c.bg} ${c.text}`}>
          <CIIcon status={ciStatus!} className="w-2.5 h-2.5" />
          {ciStatus === "success" ? "✓" : ciStatus === "failure" ? "✗" : "…"}
        </span>
      )}
    </a>
  );
}

/* ── VARIATION 2: PR badge + floating dot on top-right corner ────────────── */
function V2({ status, ciStatus, ciSummary, url = "#" }: Props) {
  const showCI = status === "IN_PROGRESS" && ciStatus;
  const c = ciStatus ? ciColors[ciStatus] : null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className="inline-flex items-center cursor-pointer relative">
      <span className={`inline-flex items-center gap-1 h-5 px-2 text-[11px] font-medium rounded-full
        ${status === "IN_PROGRESS" ? "bg-[#238636] text-white" :
          status === "CANCELLED"   ? "bg-[#6e7681] text-white" :
                                     "bg-[#8957e5] text-white"}`}>
        <PRIcon status={status} />{prLabel(status)}<ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </span>
      {showCI && c && (
        <span title={ciSummary ?? ciLabel(ciStatus!)}
          className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-background ${c.dot}
            ${ciStatus === "pending" ? "animate-pulse" : ""}`} />
      )}
    </a>
  );
}

/* ── VARIATION 3: Stacked — PR on top, CI bar underneath ────────────────── */
function V3({ status, ciStatus, ciSummary, url = "#" }: Props) {
  const showCI = status === "IN_PROGRESS" && ciStatus;
  const c = ciStatus ? ciColors[ciStatus] : null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className="inline-flex flex-col items-start gap-0.5 cursor-pointer">
      <span className={`inline-flex items-center gap-1 h-5 px-2 text-[11px] font-medium rounded-full
        ${status === "IN_PROGRESS" ? "bg-[#238636] text-white" :
          status === "CANCELLED"   ? "bg-[#6e7681] text-white" :
                                     "bg-[#8957e5] text-white"}`}>
        <PRIcon status={status} />{prLabel(status)}<ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </span>
      {showCI && c && (
        <span title={ciSummary} className={`inline-flex items-center gap-1 px-1.5 h-3.5 text-[9px]
          font-medium rounded-sm border ${c.border} ${c.bg} ${c.text}`}>
          <CIIcon status={ciStatus!} className="w-2 h-2" />
          {ciLabel(ciStatus!)}
        </span>
      )}
    </a>
  );
}

/* ── VARIATION 4: Single pill with CI colour-coded left accent bar ───────── */
function V4({ status, ciStatus, ciSummary, url = "#" }: Props) {
  const showCI = status === "IN_PROGRESS" && ciStatus;
  const c = ciStatus ? ciColors[ciStatus] : null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className="inline-flex items-stretch cursor-pointer rounded-full overflow-hidden">
      {showCI && c && (
        <span title={ciSummary} className={`inline-flex items-center px-1.5 ${c.bg}`}>
          <CIIcon status={ciStatus!} className={`w-2.5 h-2.5 ${c.text}`} />
        </span>
      )}
      <span className={`inline-flex items-center gap-1 h-5 px-2 text-[11px] font-medium
        ${status === "IN_PROGRESS" ? "bg-[#238636] text-white" :
          status === "CANCELLED"   ? "bg-[#6e7681] text-white" :
                                     "bg-[#8957e5] text-white"}`}>
        <PRIcon status={status} />{prLabel(status)}<ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </span>
    </a>
  );
}

/* ── VARIATION 5: GitHub-style text — "Open" with separate CI text label ── */
function V5({ status, ciStatus, ciSummary, url = "#" }: Props) {
  const showCI = status === "IN_PROGRESS" && ciStatus;
  const c = ciStatus ? ciColors[ciStatus] : null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 cursor-pointer group">
      <span className={`inline-flex items-center gap-1 h-5 px-2 text-[11px] font-medium rounded-full
        ${status === "IN_PROGRESS" ? "bg-[#238636] text-white" :
          status === "CANCELLED"   ? "bg-[#6e7681] text-white" :
                                     "bg-[#8957e5] text-white"}`}>
        <PRIcon status={status} />{prLabel(status)}<ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </span>
      {showCI && c && (
        <span title={ciSummary} className={`inline-flex items-center gap-1 text-[10px] font-medium ${c.text}`}>
          <CIIcon status={ciStatus!} className="w-3 h-3" />
          <span className="hidden group-hover:inline">{ciLabel(ciStatus!)}</span>
        </span>
      )}
    </a>
  );
}

/* ── sample data ─────────────────────────────────────────────────────────── */
const CASES: { label: string; status: PRStatus; ciStatus?: CIStatus; ciSummary?: string }[] = [
  { label: "Open — no CI yet",    status: "IN_PROGRESS" },
  { label: "Open — CI pending",   status: "IN_PROGRESS", ciStatus: "pending", ciSummary: "Checks running…" },
  { label: "Open — CI passing",   status: "IN_PROGRESS", ciStatus: "success", ciSummary: "6/6 checks passed" },
  { label: "Open — CI failing",   status: "IN_PROGRESS", ciStatus: "failure", ciSummary: "build: failed" },
  { label: "Merged (CI hidden)",  status: "DONE",        ciStatus: "success" },
  { label: "Closed (CI hidden)",  status: "CANCELLED",   ciStatus: "failure" },
];

const VARIATIONS = [
  { id: 1, name: "Connected pills", desc: "CI appended as a flush secondary pill", Comp: V1 },
  { id: 2, name: "Dot overlay",     desc: "Small coloured dot pinned to top-right corner", Comp: V2 },
  { id: 3, name: "Stacked",         desc: "CI label on a second line below the badge", Comp: V3 },
  { id: 4, name: "Left accent",     desc: "CI icon left-docked inside one pill", Comp: V4 },
  { id: 5, name: "Inline text",     desc: "Separate icon + label — label reveals on hover", Comp: V5 },
];

export default function TestCIBadgePage() {
  return (
    <div className="p-10 bg-background min-h-screen font-sans">
      <h1 className="text-sm font-semibold mb-1">PR Badge — CI/CD layout variations</h1>
      <p className="text-xs text-muted-foreground mb-8">Five approaches for surfacing CI status alongside the PR badge.</p>

      <div className="grid grid-cols-1 gap-8">
        {VARIATIONS.map(({ id, name, desc, Comp }) => (
          <div key={id}>
            <div className="mb-3">
              <span className="text-xs font-semibold text-foreground">V{id} — {name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{desc}</span>
            </div>
            <div className="border rounded-md overflow-hidden divide-y divide-border">
              {CASES.map(({ label, status, ciStatus, ciSummary }) => (
                <div key={label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-muted-foreground w-48 shrink-0">{label}</span>
                  <Comp status={status} ciStatus={ciStatus} ciSummary={ciSummary} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
