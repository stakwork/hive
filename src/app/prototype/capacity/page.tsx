"use client";

import { useState } from "react";
import {
  Server,
  GitBranch,
  Copy,
  ExternalLink,
  RefreshCw,
  Flag,
  Cpu,
  MemoryStick,
  Clock,
  Loader,
  Terminal,
  AlertTriangle,
  CheckCircle,
  Radio,
} from "lucide-react";

// ─── Mock data ────────────────────────────────────────────────────────────────

const PODS = [
  {
    id: "hive-pod-a1b2c3",
    subdomain: "hive-pod-a1b2c3",
    state: "running",
    usage_status: "used",
    task_id: "clxyz123abc",
    task_title: "Redesign capacity page cards",
    assignee: "Alex Kim",
    marked_at: "2026-03-04T07:26:00Z",
    branches: ["feat/capacity-redesign"],
    cpu_usage: "340m", cpu_req: "1000m",
    mem_usage: "1.2Gi", mem_req: "2Gi",
    flagged: false, flagReason: null,
    password: "s3cr3t", url: "https://hive-pod-a1b2c3.pods.example.com",
  },
  {
    id: "hive-pod-d4e5f6",
    subdomain: "hive-pod-d4e5f6",
    state: "running",
    usage_status: "used",
    task_id: "cluvw456def",
    task_title: "Fix auth token refresh bug",
    assignee: "Jamie Park",
    marked_at: "2026-03-04T08:53:00Z",
    branches: ["fix/auth-token-refresh"],
    cpu_usage: "780m", cpu_req: "1000m",
    mem_usage: "1.8Gi", mem_req: "2Gi",
    flagged: false, flagReason: null,
    password: "p@ss", url: "https://hive-pod-d4e5f6.pods.example.com",
  },
  {
    id: "hive-pod-g7h8i9",
    subdomain: "hive-pod-g7h8i9",
    state: "running",
    usage_status: "unused",
    task_id: null, task_title: null, assignee: null,
    marked_at: null,
    branches: ["main"],
    cpu_usage: "20m", cpu_req: "1000m",
    mem_usage: "210Mi", mem_req: "2Gi",
    flagged: false, flagReason: null,
    password: "free!", url: "https://hive-pod-g7h8i9.pods.example.com",
  },
  {
    id: "hive-pod-j0k1l2",
    subdomain: "hive-pod-j0k1l2",
    state: "running",
    usage_status: "used",
    task_id: "clrst789ghi",
    task_title: "Implement feature flags UI",
    assignee: "Morgan Chen",
    marked_at: "2026-03-04T05:07:00Z",
    branches: ["feat/feature-flags-ui"],
    cpu_usage: "550m", cpu_req: "1000m",
    mem_usage: "900Mi", mem_req: "2Gi",
    flagged: true, flagReason: "HEALTH_CHECK_FAILED",
    password: "h2!", url: "https://hive-pod-j0k1l2.pods.example.com",
  },
  {
    id: "hive-pod-m3n4o5",
    subdomain: "hive-pod-m3n4o5",
    state: "pending",
    usage_status: "unused",
    task_id: null, task_title: null, assignee: null,
    marked_at: null,
    branches: [],
    cpu_usage: "0m", cpu_req: "1000m",
    mem_usage: "0Mi", mem_req: "2Gi",
    flagged: false, flagReason: null,
    password: null, url: null,
  },
  {
    id: "hive-pod-p6q7r8",
    subdomain: "hive-pod-p6q7r8",
    state: "running",
    usage_status: "unused",
    task_id: null, task_title: null, assignee: null,
    marked_at: null,
    branches: ["main"],
    cpu_usage: "15m", cpu_req: "1000m",
    mem_usage: "190Mi", mem_req: "2Gi",
    flagged: false, flagReason: null,
    password: "openssl", url: "https://hive-pod-p6q7r8.pods.example.com",
  },
  {
    id: "hive-pod-s9t0u1",
    subdomain: "hive-pod-s9t0u1",
    state: "crashing",
    usage_status: "unused",
    task_id: null, task_title: null, assignee: null,
    marked_at: null,
    branches: [],
    cpu_usage: "0m", cpu_req: "1000m",
    mem_usage: "0Mi", mem_req: "2Gi",
    flagged: true, flagReason: "POOL_CONFIG_CHANGED",
    password: null, url: null,
  },
  {
    id: "hive-pod-v2w3x4",
    subdomain: "hive-pod-v2w3x4",
    state: "running",
    usage_status: "used",
    task_id: "clopq012jkl",
    task_title: "DB migration for feature phases",
    assignee: "Sam Liu",
    marked_at: "2026-03-04T09:01:00Z",
    branches: ["chore/db-migration-phases"],
    cpu_usage: "220m", cpu_req: "1000m",
    mem_usage: "600Mi", mem_req: "2Gi",
    flagged: false, flagReason: null,
    password: "qwerty", url: "https://hive-pod-v2w3x4.pods.example.com",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Pod = typeof PODS[0];

function parseCpu(usage: string, req: string) {
  const mc = (s: string) => s.endsWith("m") ? parseFloat(s) : parseFloat(s) * 1000;
  return Math.min((mc(usage) / mc(req)) * 100, 100);
}

function parseMem(usage: string, req: string) {
  const mb = (s: string) => {
    if (s.endsWith("Gi")) return parseFloat(s) * 1024;
    if (s.endsWith("Mi")) return parseFloat(s);
    return parseFloat(s);
  };
  return Math.min((mb(usage) / mb(req)) * 100, 100);
}

function elapsed(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortId(id: string) {
  return id.slice(-8).toUpperCase();
}

function podStatus(pod: Pod): "active" | "free" | "starting" | "error" {
  if (pod.state === "running" && pod.usage_status === "used") return "active";
  if (pod.state === "running") return "free";
  if (pod.state === "pending" || pod.state === "starting") return "starting";
  return "error";
}

// ─── Resource bar ─────────────────────────────────────────────────────────────

function Bar({ pct, warn = 70 }: { pct: number; warn?: number }) {
  const color = pct > 85 ? "#ef4444" : pct > warn ? "#f59e0b" : "#22d3ee";
  return (
    <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99 }}>
      <div style={{
        height: "100%",
        width: `${pct}%`,
        background: color,
        borderRadius: 99,
        boxShadow: pct > 50 ? `0 0 6px ${color}88` : undefined,
        transition: "width 0.6s ease",
      }} />
    </div>
  );
}

// ─── Pod Card ─────────────────────────────────────────────────────────────────

function PodCard({ pod }: { pod: Pod }) {
  const [copied, setCopied] = useState(false);
  const status = podStatus(pod);
  const cpuPct = parseCpu(pod.cpu_usage, pod.cpu_req);
  const memPct = parseMem(pod.mem_usage, pod.mem_req);
  const isActive = status === "active";
  const hasMetrics = pod.state === "running";

  const cfg = {
    active: {
      ring: "rgba(34,211,238,0.22)",
      glow: "0 0 24px rgba(34,211,238,0.1), 0 1px 0 rgba(34,211,238,0.3) inset",
      dot: "#22d3ee",
      label: "ACTIVE",
      labelColor: "#22d3ee",
      bg: "rgba(34,211,238,0.04)",
      accentBorder: "rgba(34,211,238,0.22)",
    },
    free: {
      ring: "rgba(74,222,128,0.18)",
      glow: "0 0 16px rgba(74,222,128,0.06)",
      dot: "#4ade80",
      label: "FREE",
      labelColor: "#4ade80",
      bg: "rgba(74,222,128,0.025)",
      accentBorder: "rgba(74,222,128,0.18)",
    },
    starting: {
      ring: "rgba(251,191,36,0.18)",
      glow: "0 0 16px rgba(251,191,36,0.06)",
      dot: "#fbbf24",
      label: "INIT",
      labelColor: "#fbbf24",
      bg: "rgba(251,191,36,0.025)",
      accentBorder: "rgba(251,191,36,0.18)",
    },
    error: {
      ring: "rgba(239,68,68,0.22)",
      glow: "0 0 16px rgba(239,68,68,0.08)",
      dot: "#ef4444",
      label: "ERR",
      labelColor: "#ef4444",
      bg: "rgba(239,68,68,0.035)",
      accentBorder: "rgba(239,68,68,0.22)",
    },
  }[status];

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.ring}`,
      borderRadius: 12,
      padding: "15px 16px",
      boxShadow: cfg.glow,
      display: "flex",
      flexDirection: "column",
      gap: 11,
      position: "relative",
      overflow: "hidden",
      transition: "box-shadow 0.2s, border-color 0.2s",
    }}>
      {/* Scan line texture */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 12,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.008) 3px, rgba(255,255,255,0.008) 4px)",
      }} />

      {/* Top-right corner radial accent */}
      {isActive && (
        <div style={{
          position: "absolute", top: 0, right: 0, width: 80, height: 80, pointerEvents: "none",
          background: "radial-gradient(circle at top right, rgba(34,211,238,0.1), transparent 70%)",
          borderRadius: "0 12px 0 0",
        }} />
      )}

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {/* Status dot */}
          <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: cfg.dot,
              boxShadow: `0 0 7px ${cfg.dot}`,
            }} />
            {isActive && (
              <div style={{
                position: "absolute", inset: -3, borderRadius: "50%",
                border: `1px solid ${cfg.dot}`,
                opacity: 0.5,
                animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite",
              }} />
            )}
          </div>
          {/* Pod name */}
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11, letterSpacing: "0.04em",
            color: "rgba(255,255,255,0.55)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {pod.subdomain}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {pod.flagged && (
            <Flag size={11} color="#f59e0b" style={{ opacity: 0.8 }} />
          )}
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: 9,
            color: cfg.labelColor, letterSpacing: "0.15em",
            background: `${cfg.dot}15`,
            padding: "2px 7px", borderRadius: 4,
            border: `1px solid ${cfg.dot}28`,
          }}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* ── Task block (active pods) ── */}
      {isActive && pod.task_title && (
        <div style={{
          borderLeft: `2px solid ${cfg.dot}55`,
          paddingLeft: 10,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <p style={{
            margin: 0, fontSize: 12,
            color: "rgba(255,255,255,0.78)",
            lineHeight: 1.45,
          }}>
            {pod.task_title}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: 9,
              color: "#22d3ee50", letterSpacing: "0.06em",
              background: "rgba(34,211,238,0.08)",
              padding: "1px 5px", borderRadius: 3,
            }}>
              {shortId(pod.task_id!)}
            </span>
            {pod.assignee && (
              <>
                <span style={{ color: "rgba(255,255,255,0.12)", fontSize: 10 }}>·</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>{pod.assignee}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Pending state ── */}
      {status === "starting" && (
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Loader size={11} color="#fbbf2480" style={{ animation: "spin 1.5s linear infinite" }} />
          <span style={{ fontSize: 11, color: "rgba(251,191,36,0.5)" }}>Initialising environment…</span>
        </div>
      )}

      {/* ── Error state ── */}
      {status === "error" && (
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <AlertTriangle size={11} color="#ef444480" />
          <span style={{ fontSize: 11, color: "rgba(239,68,68,0.5)" }}>
            {pod.flagReason === "POOL_CONFIG_CHANGED" ? "Config mismatch" : pod.state}
          </span>
        </div>
      )}

      {/* ── Branch ── */}
      {pod.branches.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
          <GitBranch size={10} color="rgba(255,255,255,0.2)" style={{ flexShrink: 0 }} />
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: 10,
            color: "rgba(255,255,255,0.28)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {pod.branches[0]}
          </span>
        </div>
      )}

      {/* ── Elapsed ── */}
      {pod.marked_at && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Clock size={10} color="rgba(255,255,255,0.18)" style={{ flexShrink: 0 }} />
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: 10,
            color: "rgba(255,255,255,0.24)",
          }}>
            {elapsed(pod.marked_at)}
          </span>
        </div>
      )}

      {/* ── Resource bars ── */}
      {hasMetrics && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.055)",
        }}>
          {[
            { icon: <Cpu size={9} color="rgba(255,255,255,0.28)" />, label: "CPU", pct: cpuPct, raw: `${pod.cpu_usage} / ${pod.cpu_req}` },
            { icon: <MemoryStick size={9} color="rgba(255,255,255,0.28)" />, label: "MEM", pct: memPct, raw: `${pod.mem_usage} / ${pod.mem_req}` },
          ].map(({ icon, label, pct, raw }) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {icon}
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: 9,
                    color: "rgba(255,255,255,0.24)", letterSpacing: "0.1em",
                  }}>
                    {label}
                  </span>
                </div>
                <span style={{
                  fontFamily: "'DM Mono', monospace", fontSize: 9,
                  color: pct > 70 ? "#f59e0b" : "rgba(255,255,255,0.28)",
                }}>
                  {raw}
                </span>
              </div>
              <Bar pct={pct} />
            </div>
          ))}
        </div>
      )}

      {/* ── Action buttons ── */}
      {pod.password && pod.url && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              height: 30,
              background: copied ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${copied ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.07)"}`,
              borderRadius: 7, cursor: "pointer",
              fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "0.06em",
              color: copied ? "#4ade80" : "rgba(255,255,255,0.38)",
              transition: "all 0.2s",
            }}
          >
            <Copy size={10} />
            {copied ? "copied" : "pwd"}
          </button>
          <button
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              height: 30,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 7, cursor: "pointer",
              fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "0.06em",
              color: "rgba(255,255,255,0.38)",
              transition: "all 0.2s",
            }}
          >
            <ExternalLink size={10} />
            ide
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar() {
  const total = PODS.length;
  const active = PODS.filter(p => podStatus(p) === "active").length;
  const free = PODS.filter(p => podStatus(p) === "free").length;
  const errors = PODS.filter(p => podStatus(p) === "error").length;
  const flagged = PODS.filter(p => p.flagged).length;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
      {[
        { label: "TOTAL", value: total, color: "rgba(255,255,255,0.45)", icon: <Server size={11} /> },
        { label: "ACTIVE", value: active, color: "#22d3ee", icon: <Radio size={11} /> },
        { label: "FREE", value: free, color: "#4ade80", icon: <CheckCircle size={11} /> },
        ...(errors > 0 ? [{ label: "ERROR", value: errors, color: "#ef4444", icon: <AlertTriangle size={11} /> }] : []),
        ...(flagged > 0 ? [{ label: "FLAGGED", value: flagged, color: "#f59e0b", icon: <Flag size={11} /> }] : []),
      ].map(({ label, value, color, icon }) => (
        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: 0.7 }}>
            <span style={{ color }}>{icon}</span>
          </div>
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 600,
            color, lineHeight: 1, letterSpacing: "-0.02em",
          }}>
            {value}
          </span>
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: 9,
            color: "rgba(255,255,255,0.22)", letterSpacing: "0.14em",
          }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CapacityPage() {
  const [now] = useState(new Date("2026-03-04T09:56:00Z"));

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0c",
      backgroundImage: `
        radial-gradient(ellipse 80% 45% at 50% -8%, rgba(34,211,238,0.055) 0%, transparent 60%),
        linear-gradient(rgba(255,255,255,0.013) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.013) 1px, transparent 1px)
      `,
      backgroundSize: "100% 100%, 40px 40px, 40px 40px",
      fontFamily: "'Geist Sans', 'Inter', sans-serif",
      color: "rgba(255,255,255,0.9)",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes ping {
          75%, 100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>

      {/* Top bar */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.055)",
        padding: "10px 32px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        backdropFilter: "blur(12px)",
        background: "rgba(10,10,12,0.75)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <Terminal size={12} color="rgba(255,255,255,0.25)" />
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 10,
          color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em",
        }}>
          PROTOTYPE · /prototype/capacity
        </span>
        <div style={{ flex: 1 }} />
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 10,
          color: "rgba(255,255,255,0.18)",
        }}>
          {now.toISOString().replace("T", " ").replace(".000Z", "")} UTC
        </span>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "40px 32px" }}>

        {/* Page header */}
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 36,
          gap: 24,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <h1 style={{
                margin: "0 0 5px",
                fontSize: 30, fontWeight: 600,
                letterSpacing: "-0.025em",
                color: "rgba(255,255,255,0.92)",
                lineHeight: 1,
              }}>
                Capacity
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.3)" }}>
                hive-production · pod pool
              </p>
            </div>
            <StatsBar />
          </div>

          <button style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 9, padding: "9px 16px", cursor: "pointer",
            fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "0.07em",
            color: "rgba(255,255,255,0.4)",
            flexShrink: 0,
            marginTop: 4,
          }}>
            <RefreshCw size={12} />
            REFRESH
          </button>
        </div>

        {/* Pod grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
          gap: 10,
        }}>
          {PODS.map(pod => <PodCard key={pod.id} pod={pod} />)}
        </div>
      </div>
    </div>
  );
}
