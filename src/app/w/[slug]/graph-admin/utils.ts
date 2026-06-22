import type { SwarmCmd } from "@/services/swarm/cmd";
import type { BoltwallUser } from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function postGraphAdminCmd(workspaceSlug: string, cmd: SwarmCmd) {
  const res = await fetch(`/api/workspaces/${workspaceSlug}/graph-admin/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const swarmMsg = err?.swarm
      ? (typeof err.swarm === "string" ? err.swarm : err.swarm?.message ?? null)
      : null;
    throw new Error(swarmMsg ?? err?.error ?? "Request failed");
  }
  return res.json();
}

export function roleToNumber(role: string): number {
  if (role === "admin" || role === "sub_admin") return 2;
  if (role === "member") return 3;
  return 3;
}

export function getRoleLabel(role: BoltwallUser["role"]): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

export function getInitials(name: string | null, pubkey: string | null): string {
  if (name) return name.slice(0, 2).toUpperCase();
  if (pubkey) return pubkey.slice(0, 2).toUpperCase();
  return "??";
}
