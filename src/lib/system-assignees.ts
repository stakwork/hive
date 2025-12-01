import { SystemAssigneeType } from "@prisma/client";

// System assignee configuration
export const SYSTEM_ASSIGNEE_CONFIG = {
  [SystemAssigneeType.TASK_COORDINATOR]: {
    id: "system:task-coordinator",
    name: "Task Coordinator",
    image: null,
    icon: "bot",
    enumValue: SystemAssigneeType.TASK_COORDINATOR,
  },
  [SystemAssigneeType.BOUNTY_HUNTER]: {
    id: "system:bounty-hunter",
    name: "Bounty Hunter",
    image: "/sphinx_icon.png",
    icon: null,
    enumValue: SystemAssigneeType.BOUNTY_HUNTER,
  },
} as const;

export type SystemAssigneeId = "system:task-coordinator" | "system:bounty-hunter";

export function isSystemAssigneeId(id: string | null | undefined): id is SystemAssigneeId {
  if (!id) return false;
  return id === "system:task-coordinator" || id === "system:bounty-hunter";
}

export function getSystemAssigneeEnum(id: string): SystemAssigneeType | null {
  if (id === "system:task-coordinator") return SystemAssigneeType.TASK_COORDINATOR;
  if (id === "system:bounty-hunter") return SystemAssigneeType.BOUNTY_HUNTER;
  return null;
}

export function getSystemAssigneeUser(enumValue: SystemAssigneeType) {
  const config = SYSTEM_ASSIGNEE_CONFIG[enumValue];
  if (!config) return null;

  return {
    id: config.id,
    name: config.name,
    email: null,
    image: config.image,
    icon: config.icon,
  };
}
