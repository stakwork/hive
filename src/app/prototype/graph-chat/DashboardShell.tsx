"use client";

/**
 * Reproduces the EXACT widget positions from production DashboardInner,
 * so variations only differ in the chat area.
 *
 * Slots:
 *   children  → the chat component, rendered inside the same absolute-positioned
 *               div that DashboardChat lives in:
 *               bottom-4, left-1/2 -translate-x-1/2, width calc(100% - 340px)
 */

import { MockGraph } from "./MockGraph";
import { WIDGET_DATA } from "./mockData";
import {
  Github,
  Cpu,
  BarChart3,
  Bell,
  GitPullRequest,
  Filter,
  TestTube2,
  Loader2,
} from "lucide-react";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 h-full relative overflow-hidden">
      {/* ── graph canvas ── */}
      <div className="absolute inset-0">
        <MockGraph />
      </div>

      {/* ── top-left: ingestion status (idle in mock) ── */}
      <div className="absolute top-4 left-4 z-10">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card/90 backdrop-blur-sm text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="font-mono">Ingesting codebase…</span>
        </div>
      </div>

      {/* ── top-right: widget row (exact production order) ── */}
      <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          {/* GraphFilterDropdown stub */}
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border/50 bg-card/90 backdrop-blur-sm text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Filter className="w-3.5 h-3.5" />
            All
          </button>
          {/* TestFilterDropdown stub */}
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border/50 bg-card/90 backdrop-blur-sm text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <TestTube2 className="w-3.5 h-3.5" />
            Tests
          </button>
          {/* NeedsInput */}
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-amber-500/40 bg-amber-500/10 backdrop-blur-sm text-xs font-medium text-amber-400">
            <Bell className="w-3.5 h-3.5" />
            {WIDGET_DATA.needsInput} needs input
          </button>
          {/* PRMetrics */}
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border/50 bg-card/90 backdrop-blur-sm text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <GitPullRequest className="w-3.5 h-3.5" />
            {WIDGET_DATA.github.prs} PRs
          </button>
          {/* GitHub */}
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border/50 bg-card/90 backdrop-blur-sm text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Github className="w-3.5 h-3.5" />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </button>
          {/* Pool */}
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border/50 bg-card/90 backdrop-blur-sm text-xs font-medium">
            <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_#34d399]" />
            <span className="text-emerald-400">{WIDGET_DATA.pool.health}%</span>
          </button>
        </div>
        {/* TestCoverageStats stub — shown when test layer active */}
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-border/40 bg-card/80 backdrop-blur-sm text-xs">
          <BarChart3 className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground">Unit</span>
          <span className="font-semibold">{WIDGET_DATA.coverage.unit}%</span>
          <span className="text-border/60">|</span>
          <span className="text-muted-foreground">Integration</span>
          <span className="font-semibold">{WIDGET_DATA.coverage.integration}%</span>
        </div>
      </div>

      {/* ── bottom-left: members ── */}
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1">
        {WIDGET_DATA.members.map((m) => (
          <div
            key={m.initials}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-background shadow"
            style={{ background: m.color }}
          >
            {m.initials}
          </div>
        ))}
      </div>

      {/* ── chat slot — mirrors production positioning ── */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20"
        style={{ width: "calc(100% - 340px)" }}
      >
        {children}
      </div>
    </div>
  );
}
