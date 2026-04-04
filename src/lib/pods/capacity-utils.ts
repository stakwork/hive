import { VMData } from "@/types/pool-manager";

/**
 * Merges real-time metrics from the pool-manager into the existing DB-enriched
 * VM data. Only `state`, `internal_state`, and `resource_usage` are updated from
 * the incoming payload — all other fields (e.g. `assignedTask`, `user_info`,
 * `password`) are preserved from the existing record.
 *
 * VMs present in `incoming` but absent from `existing` are appended as-is
 * (e.g. newly spun-up pods not yet in the DB snapshot).
 */
export function mergeMetricsIntoVmData(existing: VMData[], incoming: VMData[]): VMData[] {
  const existingMap = new Map(existing.map((vm) => [vm.id, vm]));
  return incoming.map((incomingVm) => {
    const base = existingMap.get(incomingVm.id);
    if (!base) return incomingVm; // new pod — no DB record yet, use as-is
    return {
      ...base, // preserve assignedTask, user_info, password, etc.
      state: incomingVm.state,
      internal_state: incomingVm.internal_state,
      resource_usage: incomingVm.resource_usage,
    };
  });
}
