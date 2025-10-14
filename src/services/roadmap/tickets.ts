import { db } from "@/lib/db";
import { TicketStatus, Priority, SystemAssigneeType } from "@prisma/client";
import type {
  CreateTicketRequest,
  UpdateTicketRequest,
  TicketWithDetails,
  TicketDetail,
} from "@/types/roadmap";
import { validateFeatureAccess, validateTicketAccess, calculateNextOrder } from "./utils";
import { USER_SELECT } from "@/lib/db/selects";
import { validateEnum } from "@/lib/validators";

// System assignee configuration
const SYSTEM_ASSIGNEE_CONFIG = {
  "system:task-coordinator": {
    enumValue: SystemAssigneeType.TASK_COORDINATOR,
    name: "Task Coordinator",
    image: null,
  },
  "system:bounty-hunter": {
    enumValue: SystemAssigneeType.BOUNTY_HUNTER,
    name: "Bounty Hunter",
    image: "/sphinx_icon.png",
  },
} as const;

type SystemAssigneeId = keyof typeof SYSTEM_ASSIGNEE_CONFIG;

function isSystemAssigneeId(id: string | null | undefined): id is SystemAssigneeId {
  if (!id) return false;
  return id in SYSTEM_ASSIGNEE_CONFIG;
}

function getSystemAssigneeEnum(id: string): SystemAssigneeType | null {
  if (!isSystemAssigneeId(id)) return null;
  return SYSTEM_ASSIGNEE_CONFIG[id].enumValue;
}

function getSystemAssigneeUser(enumValue: SystemAssigneeType) {
  const entry = Object.entries(SYSTEM_ASSIGNEE_CONFIG).find(
    ([_, config]) => config.enumValue === enumValue
  );

  if (!entry) return null;

  const [id, config] = entry;
  return {
    id,
    name: config.name,
    email: null,
    image: config.image,
  };
}

/**
 * Gets a ticket with full context (feature, phase, creator, updater)
 */
export async function getTicket(
  ticketId: string,
  userId: string
): Promise<TicketDetail> {
  const ticket = await validateTicketAccess(ticketId, userId);
  if (!ticket) {
    throw new Error("Ticket not found or access denied");
  }

  const ticketDetail = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      dependsOnTicketIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      feature: {
        select: {
          id: true,
          title: true,
          workspaceId: true,
        },
      },
      createdBy: {
        select: USER_SELECT,
      },
      updatedBy: {
        select: USER_SELECT,
      },
    },
  });

  if (!ticketDetail) {
    throw new Error("Ticket not found");
  }

  // Convert system assignee type to virtual user object
  if (ticketDetail.systemAssigneeType) {
    const systemAssignee = ticketDetail.systemAssigneeType === "TASK_COORDINATOR"
      ? {
          id: "system:task-coordinator",
          name: "Task Coordinator",
          email: null,
          image: null,
        }
      : {
          id: "system:bounty-hunter",
          name: "Bounty Hunter",
          email: null,
          image: "/sphinx_icon.png",
        };

    return {
      ...ticketDetail,
      assignee: systemAssignee,
    };
  }

  return ticketDetail;
}

/**
 * Creates a new ticket for a feature
 */
export async function createTicket(
  featureId: string,
  userId: string,
  data: CreateTicketRequest
): Promise<TicketWithDetails> {
  const feature = await validateFeatureAccess(featureId, userId);
  if (!feature) {
    throw new Error("Feature not found or access denied");
  }

  if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
    throw new Error("Title is required");
  }

  validateEnum(data.status, TicketStatus, "status");
  validateEnum(data.priority, Priority, "priority");

  if (data.phaseId) {
    const phase = await db.phase.findFirst({
      where: {
        id: data.phaseId,
        featureId: featureId,
      },
    });

    if (!phase) {
      throw new Error("Phase not found or does not belong to this feature");
    }
  }

  if (data.assigneeId) {
    // Skip validation for system assignees
    if (!data.assigneeId.startsWith("system:")) {
      const assignee = await db.user.findUnique({
        where: { id: data.assigneeId },
      });

      if (!assignee) {
        throw new Error("Assignee not found");
      }
    }
  }

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const nextOrder = await calculateNextOrder(db.ticket, {
    featureId,
    phaseId: data.phaseId || null,
  });

  // Determine if assignee is a system assignee
  const isSystemAssignee = data.assigneeId?.startsWith("system:");
  const systemAssigneeType = isSystemAssignee
    ? data.assigneeId === "system:task-coordinator"
      ? "TASK_COORDINATOR"
      : "BOUNTY_HUNTER"
    : null;

  const ticket = await db.ticket.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      featureId,
      phaseId: data.phaseId || null,
      status: data.status || TicketStatus.TODO,
      priority: data.priority || Priority.MEDIUM,
      order: nextOrder,
      assigneeId: isSystemAssignee ? null : (data.assigneeId || null),
      systemAssigneeType: systemAssigneeType,
      createdById: userId,
      updatedById: userId,
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      dependsOnTicketIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Convert system assignee type to virtual user object
  if (ticket.systemAssigneeType) {
    const systemAssignee = ticket.systemAssigneeType === "TASK_COORDINATOR"
      ? {
          id: "system:task-coordinator",
          name: "Task Coordinator",
          email: null,
          image: null,
        }
      : {
          id: "system:bounty-hunter",
          name: "Bounty Hunter",
          email: null,
          image: "/sphinx_icon.png",
        };

    return {
      ...ticket,
      assignee: systemAssignee,
    };
  }

  return ticket;
}

/**
 * Updates a ticket
 */
export async function updateTicket(
  ticketId: string,
  userId: string,
  data: UpdateTicketRequest
): Promise<TicketWithDetails> {
  const ticket = await validateTicketAccess(ticketId, userId);
  if (!ticket) {
    throw new Error("Ticket not found or access denied");
  }

  const updateData: any = {
    updatedById: userId,
  };

  if (data.title !== undefined) {
    if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
      throw new Error("Title cannot be empty");
    }
    updateData.title = data.title.trim();
  }

  if (data.description !== undefined) {
    updateData.description = data.description?.trim() || null;
  }

  if (data.status !== undefined) {
    validateEnum(data.status, TicketStatus, "status");
    updateData.status = data.status;
  }

  if (data.priority !== undefined) {
    validateEnum(data.priority, Priority, "priority");
    updateData.priority = data.priority;
  }

  if (data.phaseId !== undefined) {
    if (data.phaseId !== null) {
      const phase = await db.phase.findFirst({
        where: {
          id: data.phaseId,
          featureId: ticket.featureId,
        },
      });

      if (!phase) {
        throw new Error("Phase not found or does not belong to this feature");
      }
    }
    updateData.phaseId = data.phaseId;
  }

  if (data.assigneeId !== undefined) {
    if (data.assigneeId !== null) {
      // Skip validation for system assignees
      if (!data.assigneeId.startsWith("system:")) {
        const assignee = await db.user.findUnique({
          where: { id: data.assigneeId },
        });

        if (!assignee) {
          throw new Error("Assignee not found");
        }
      }
    }

    // Handle system assignees
    const isSystemAssignee = data.assigneeId?.startsWith("system:");
    if (isSystemAssignee) {
      updateData.assigneeId = null;
      updateData.systemAssigneeType = data.assigneeId === "system:task-coordinator"
        ? "TASK_COORDINATOR"
        : "BOUNTY_HUNTER";
    } else {
      updateData.assigneeId = data.assigneeId;
      updateData.systemAssigneeType = null;
    }
  }

  if (data.order !== undefined) {
    if (typeof data.order !== "number") {
      throw new Error("Order must be a number");
    }
    updateData.order = data.order;
  }

  if (data.dependsOnTicketIds !== undefined) {
    if (!Array.isArray(data.dependsOnTicketIds)) {
      throw new Error("dependsOnTicketIds must be an array");
    }

    // Prevent ticket from depending on itself
    if (data.dependsOnTicketIds.includes(ticketId)) {
      throw new Error("A ticket cannot depend on itself");
    }

    // Validate all dependency tickets exist and belong to same feature
    if (data.dependsOnTicketIds.length > 0) {
      const dependencyTickets = await db.ticket.findMany({
        where: {
          id: { in: data.dependsOnTicketIds },
          deleted: false,
        },
        select: {
          id: true,
          featureId: true,
        },
      });

      if (dependencyTickets.length !== data.dependsOnTicketIds.length) {
        throw new Error("One or more dependency tickets not found");
      }

      // Check all dependency tickets belong to same feature
      const invalidDependencies = dependencyTickets.filter(
        (dep) => dep.featureId !== ticket.featureId
      );
      if (invalidDependencies.length > 0) {
        throw new Error("Dependencies must be tickets from the same feature");
      }

      // Simple circular dependency check: prevent A->B and B->A
      const existingDependents = await db.ticket.findMany({
        where: {
          id: { in: data.dependsOnTicketIds },
          dependsOnTicketIds: { has: ticketId },
        },
        select: { id: true, title: true },
      });

      if (existingDependents.length > 0) {
        throw new Error(
          `Circular dependency detected with ticket(s): ${existingDependents.map((t) => t.title).join(", ")}`
        );
      }
    }

    updateData.dependsOnTicketIds = data.dependsOnTicketIds;
  }

  const updatedTicket = await db.ticket.update({
    where: { id: ticketId },
    data: updateData,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      dependsOnTicketIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Convert system assignee type to virtual user object
  if (updatedTicket.systemAssigneeType) {
    const systemAssignee = updatedTicket.systemAssigneeType === "TASK_COORDINATOR"
      ? {
          id: "system:task-coordinator",
          name: "Task Coordinator",
          email: null,
          image: null,
        }
      : {
          id: "system:bounty-hunter",
          name: "Bounty Hunter",
          email: null,
          image: "/sphinx_icon.png",
        };

    return {
      ...updatedTicket,
      assignee: systemAssignee,
    };
  }

  return updatedTicket;
}

/**
 * Soft deletes a ticket
 */
export async function deleteTicket(
  ticketId: string,
  userId: string
): Promise<void> {
  const ticket = await validateTicketAccess(ticketId, userId);
  if (!ticket) {
    throw new Error("Ticket not found or access denied");
  }

  await db.ticket.update({
    where: { id: ticketId },
    data: {
      deleted: true,
      deletedAt: new Date(),
    },
  });
}

/**
 * Reorders tickets (within or across phases)
 */
export async function reorderTickets(
  userId: string,
  tickets: { id: string; order: number; phaseId?: string | null }[]
): Promise<TicketWithDetails[]> {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new Error("Tickets must be a non-empty array");
  }

  const firstTicket = await db.ticket.findUnique({
    where: { id: tickets[0].id },
    select: { featureId: true },
  });

  if (!firstTicket) {
    throw new Error("Ticket not found");
  }

  const feature = await validateFeatureAccess(firstTicket.featureId, userId);
  if (!feature) {
    throw new Error("Access denied");
  }

  await db.$transaction(
    tickets.map((ticket) => {
      const updateData: any = { order: ticket.order };
      if (ticket.phaseId !== undefined) {
        updateData.phaseId = ticket.phaseId;
      }
      return db.ticket.update({
        where: { id: ticket.id },
        data: updateData,
      });
    })
  );

  const updatedTickets = await db.ticket.findMany({
    where: { featureId: firstTicket.featureId, deleted: false },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      dependsOnTicketIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { order: "asc" },
  });

  // Convert system assignee types to virtual user objects
  return updatedTickets.map(ticket => {
    if (ticket.systemAssigneeType) {
      const systemAssignee = ticket.systemAssigneeType === "TASK_COORDINATOR"
        ? {
            id: "system:task-coordinator",
            name: "Task Coordinator",
            email: null,
            image: null,
          }
        : {
            id: "system:bounty-hunter",
            name: "Bounty Hunter",
            email: null,
            image: "/sphinx_icon.png",
          };

      return {
        ...ticket,
        assignee: systemAssignee,
      };
    }
    return ticket;
  });
}
