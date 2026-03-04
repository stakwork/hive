"use client";

import React, { useState } from "react";
import {
  Radio,
  CheckCircle,
  AlertTriangle,
  Flag,
  Server,
  GitBranch,
  Clock,
  Cpu,
  RefreshCw,
  Copy,
  ExternalLink,
  Loader,
} from "lucide-react";
import { VMData } from "@/types/pool-manager";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignalGridProps {
  vms: VMData[];
  metricsLoading?: boolean;
  metricsError?: boolean;
  onRefresh?: () => void;
}

type PodStatus = "active" | "free" | "starting" | "error";

interface StatusConfig {
  ring: string;
  glow: string;
  dot: string;
  label: string;
  labelColor: string;
  bg: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function podStatus(vm: VMData): PodStatus {
  if (vm.state === "running" && vm.usage_status === "used") return "active";
  if (vm.state === "running") return "free";
  if (vm.state === "pending" || vm.state === "starting") return "starting";
  return "error";
}

function statusConfig(status: PodStatus): StatusConfig {
  return {
    active: {
      ring: "rgba(34,211,238,0.28)",
      glow: "0 0 18px rgba(34,211,238,0.10)",
      dot: "#22d3ee",
      label: "ACTIVE",
      labelColor: "#22d3ee",
      bg: "rgba(34,211,238,0.04)",
    },
    free: {
      ring: "rgba(74,222,128,0.22)",
      glow: "0 0 16px rgba(74,222,128,0.07)",
      dot: "#4ade80",
      label: "FREE",
      labelColor: "#4ade80",
      bg: "rgba(74,222,128,0.025)",
    },
    starting: {
      ring: "rgba(251,191,36,0.22)",
      glow: "0 0 16px rgba(251,191,36,0.08)",
      dot: "#fbbf24",
      label: "INIT",
      labelColor: "#fbbf24",
      bg: "rgba(251,191,36,0.03)",
    },
    error: {
      ring: "rgba(239,68,68,0.22)",
      glow: "0 0 16px rgba(239,68,68,0.08)",
      dot: "#ef4444",
      label: "ERR",
      labelColor: "#ef4444",
      bg: "rgba(239,68,68,0.035)",
    },
  }[status];
}

function elapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortId(id: string): string {
  return id.slice(-8).toUpperCase();
}

function parseCpuPct(usage: string, req: string): number {
  const mc = (s: string) =>
    s.endsWith("m") ? parseFloat(s) : parseFloat(s) * 1000;
  return Math.min((mc(usage) / mc(req)) * 100, 100);
}

function parseMemPct(usage: string, req: string): number {
  const mb = (s: string) => {
    if (s.endsWith("Gi")) return parseFloat(s) * 1024;
    if (s.endsWith("Mi")) return parseFloat(s);
    return parseFloat(s);
  };
  return Math.min((mb(usage) / mb(req)) * 100, 100);
}

// ─── ResourceBar ─────────────────────────────────────────────────────────────

function ResourceBar({ pct }: { pct: number }) {
  const color = pct > 85 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22d3ee";
  return (
    <div
      style={{
        height: 3,
        background: "rgba(128,128,128,0.15)",
        borderRadius: 99,
      }}
    >
      <div
        data-testid="resource-bar-fill"
        data-color={color}
        style={{
          height: "100%",
          width: `${Math.min(pct, 100)}%`,
          background: color,
          borderRadius: 99,
          boxShadow: pct > 50 ? `0 0 6px ${color}88` : undefined,
          transition: "width 0.6s ease",
        }}
      />
    </div>
  );
}

// ─── StatsBar ────────────────────────────────────────────────────────────────

function StatsBar({
  vms,
  metricsLoading,
  onRefresh,
}: {
  vms: VMData[];
  metricsLoading?: boolean;
  onRefresh?: () => void;
}) {
  const total = vms.length;
  const active = vms.filter(
    (v) => v.state === "running" && v.usage_status === "used"
  ).length;
  const free = vms.filter(
    (v) => v.state === "running" && v.usage_status !== "used"
  ).length;
  const errors = vms.filter(
    (v) => v.state === "failed" || v.state === "crashing"
  ).length;
  const flagged = vms.filter((v) => v.flaggedForRecreation === true).length;

  const stats = [
    {
      label: "TOTAL",
      value: total,
      color: "rgba(255,255,255,0.55)",
      icon: <Server size={11} />,
    },
    {
      label: "ACTIVE",
      value: active,
      color: "#22d3ee",
      icon: <Radio size={11} />,
    },
    {
      label: "FREE",
      value: free,
      color: "#4ade80",
      icon: <CheckCircle size={11} />,
    },
    ...(errors > 0
      ? [
          {
            label: "ERROR",
            value: errors,
            color: "#ef4444",
            icon: <AlertTriangle size={11} />,
          },
        ]
      : []),
    ...(flagged > 0
      ? [
          {
            label: "FLAGGED",
            value: flagged,
            color: "#f59e0b",
            icon: <Flag size={11} />,
          },
        ]
      : []),
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
        {stats.map(({ label, value, color, icon }) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "baseline", gap: 8 }}
            data-testid={`stat-${label.toLowerCase()}`}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                opacity: 0.8,
                color,
              }}
            >
              {icon}
            </div>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 22,
                fontWeight: 600,
                color,
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {value}
            </span>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                color: "var(--muted-foreground, rgba(128,128,128,0.7))",
                letterSpacing: "0.14em",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={metricsLoading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "1px solid rgba(128,128,128,0.2)",
            borderRadius: 9,
            padding: "8px 14px",
            cursor: metricsLoading ? "not-allowed" : "pointer",
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.07em",
            color: "var(--muted-foreground, rgba(128,128,128,0.7))",
            opacity: metricsLoading ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          <RefreshCw
            size={12}
            style={{
              animation: metricsLoading ? "spin 1s linear infinite" : undefined,
            }}
          />
          REFRESH
        </button>
      )}
    </div>
  );
}

// ─── PodCard ─────────────────────────────────────────────────────────────────

function PodCard({
  vm,
  metricsLoading,
  metricsError,
}: {
  vm: VMData;
  metricsLoading?: boolean;
  metricsError?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const status = podStatus(vm);
  const cfg = statusConfig(status);
  const isActive = status === "active";

  const hasMetrics = vm.resource_usage.available;
  const cpuPct = hasMetrics
    ? parseCpuPct(
        vm.resource_usage.usage.cpu,
        vm.resource_usage.requests.cpu
      )
    : 0;
  const memPct = hasMetrics
    ? parseMemPct(
        vm.resource_usage.usage.memory,
        vm.resource_usage.requests.memory
      )
    : 0;

  const handleCopyPassword = async () => {
    if (!vm.password) return;
    try {
      await navigator.clipboard.writeText(vm.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy password:", err);
    }
  };

  const handleOpenIDE = () => {
    if (!vm.url) return;
    window.open(vm.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      style={{
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
      }}
    >
      {/* Scan-line texture */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          borderRadius: 12,
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.006) 3px, rgba(255,255,255,0.006) 4px)",
        }}
      />

      {/* Top-right corner radial accent (active only) */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 80,
            height: 80,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at top right, rgba(34,211,238,0.10), transparent 70%)",
            borderRadius: "0 12px 0 0",
          }}
        />
      )}

      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          {/* Status dot with ping ring */}
          <div
            style={{
              position: "relative",
              width: 8,
              height: 8,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: cfg.dot,
                boxShadow: `0 0 7px ${cfg.dot}`,
              }}
            />
            {isActive && (
              <div
                style={{
                  position: "absolute",
                  inset: -3,
                  borderRadius: "50%",
                  border: `1px solid ${cfg.dot}`,
                  opacity: 0.5,
                  animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite",
                }}
              />
            )}
          </div>

          {/* Pod subdomain */}
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: "0.04em",
              color: "var(--muted-foreground, rgba(128,128,128,0.7))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {vm.subdomain}
          </span>
        </div>

        {/* Flag icon + Status badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {vm.flaggedForRecreation && (
            <Flag
              size={11}
              color="#f59e0b"
              style={{ opacity: 0.9 }}
              aria-label="Flagged for recreation"
            />
          )}
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9,
              color: cfg.labelColor,
              letterSpacing: "0.15em",
              background: `${cfg.dot}18`,
              padding: "2px 7px",
              borderRadius: 4,
              border: `1px solid ${cfg.dot}28`,
            }}
          >
            {cfg.label}
          </span>
        </div>
      </div>

      {/* ── Flag reason ── */}
      {vm.flaggedForRecreation && vm.flaggedReason && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              color: "#f59e0b",
              opacity: 0.7,
            }}
          >
            {vm.flaggedReason}
          </span>
        </div>
      )}

      {/* ── Task block (active pods only) ── */}
      {isActive && vm.taskTitle && (
        <div
          style={{
            borderLeft: `2px solid ${cfg.dot}55`,
            paddingLeft: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--foreground, rgba(0,0,0,0.85))",
              lineHeight: 1.45,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {vm.taskTitle}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {vm.taskId && (
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  color: "#22d3ee80",
                  letterSpacing: "0.06em",
                  background: "rgba(34,211,238,0.08)",
                  padding: "1px 5px",
                  borderRadius: 3,
                }}
              >
                {shortId(vm.taskId)}
              </span>
            )}
            {vm.assigneeName && (
              <>
                <span
                  style={{
                    color: "var(--muted-foreground, rgba(128,128,128,0.4))",
                    fontSize: 10,
                  }}
                >
                  ·
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--muted-foreground, rgba(128,128,128,0.6))",
                  }}
                >
                  {vm.assigneeName}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Starting state ── */}
      {status === "starting" && (
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Loader
            size={11}
            color="#fbbf2480"
            style={{ animation: "spin 1.5s linear infinite" }}
          />
          <span
            style={{
              fontSize: 11,
              color: "rgba(251,191,36,0.6)",
            }}
          >
            Initialising environment…
          </span>
        </div>
      )}

      {/* ── Error state ── */}
      {status === "error" && (
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <AlertTriangle size={11} color="#ef444480" />
          <span style={{ fontSize: 11, color: "rgba(239,68,68,0.6)" }}>
            {vm.flaggedReason === "POOL_CONFIG_CHANGED"
              ? "Config mismatch"
              : vm.state}
          </span>
        </div>
      )}

      {/* ── Branch ── */}
      {vm.branches && vm.branches.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflow: "hidden",
          }}
        >
          <GitBranch
            size={10}
            color="var(--muted-foreground, rgba(128,128,128,0.4))"
            style={{ flexShrink: 0 }}
          />
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              color: "var(--muted-foreground, rgba(128,128,128,0.5))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {vm.branches[0]}
          </span>
        </div>
      )}

      {/* ── Elapsed time ── */}
      {vm.marked_at && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Clock
            size={10}
            color="var(--muted-foreground, rgba(128,128,128,0.4))"
            style={{ flexShrink: 0 }}
          />
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              color: "var(--muted-foreground, rgba(128,128,128,0.45))",
            }}
          >
            {elapsed(vm.marked_at)}
          </span>
        </div>
      )}

      {/* ── Resource bars ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(128,128,128,0.1)",
        }}
      >
        {hasMetrics ? (
          [
            {
              label: "CPU",
              pct: cpuPct,
              raw: `${vm.resource_usage.usage.cpu} / ${vm.resource_usage.requests.cpu}`,
            },
            {
              label: "MEM",
              pct: memPct,
              raw: `${vm.resource_usage.usage.memory} / ${vm.resource_usage.requests.memory}`,
            },
          ].map(({ label, pct, raw }) => (
            <div
              key={label}
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Cpu
                    size={9}
                    color="var(--muted-foreground, rgba(128,128,128,0.4))"
                  />
                  <span
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 9,
                      color: "var(--muted-foreground, rgba(128,128,128,0.5))",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {label}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9,
                    color:
                      pct > 70
                        ? "#f59e0b"
                        : "var(--muted-foreground, rgba(128,128,128,0.5))",
                  }}
                >
                  {raw}
                </span>
              </div>
              <ResourceBar pct={pct} />
            </div>
          ))
        ) : (
          <>
            {metricsError ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontFamily: "'DM Mono', monospace",
                  color: "var(--muted-foreground, rgba(128,128,128,0.5))",
                  fontStyle: "italic",
                }}
              >
                Metrics unavailable
              </p>
            ) : metricsLoading ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontFamily: "'DM Mono', monospace",
                  color: "var(--muted-foreground, rgba(128,128,128,0.5))",
                  fontStyle: "italic",
                }}
              >
                Fetching metrics…
              </p>
            ) : null}
            {/* Skeleton bars */}
            {[{ label: "CPU" }, { label: "MEM" }].map(({ label }) => (
              <div
                key={label}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9,
                    color: "var(--muted-foreground, rgba(128,128,128,0.4))",
                    letterSpacing: "0.1em",
                  }}
                >
                  {label}
                </span>
                <div
                  style={{
                    height: 3,
                    background: "rgba(128,128,128,0.12)",
                    borderRadius: 99,
                    animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
                  }}
                />
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Action buttons ── */}
      {vm.password && vm.url && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleCopyPassword}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 30,
              background: "rgba(128,128,128,0.06)",
              border: "1px solid rgba(128,128,128,0.12)",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.06em",
              color: copied
                ? "#4ade80"
                : "var(--muted-foreground, rgba(128,128,128,0.6))",
              transition: "all 0.2s",
            }}
          >
            <Copy size={10} />
            {copied ? "copied" : "pwd"}
          </button>
          <button
            onClick={handleOpenIDE}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 30,
              background: "rgba(128,128,128,0.06)",
              border: "1px solid rgba(128,128,128,0.12)",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--muted-foreground, rgba(128,128,128,0.6))",
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

// ─── SignalGrid ───────────────────────────────────────────────────────────────

export function SignalGrid({
  vms,
  metricsLoading,
  metricsError,
  onRefresh,
}: SignalGridProps) {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes ping {
          75%, 100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <StatsBar vms={vms} metricsLoading={metricsLoading} onRefresh={onRefresh} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
          gap: 10,
        }}
      >
        {vms.map((vm) => (
          <PodCard
            key={vm.id}
            vm={vm}
            metricsLoading={metricsLoading}
            metricsError={metricsError}
          />
        ))}
      </div>
    </>
  );
}
