import { db } from "@/lib/db";
import { TicketStatus, Priority } from "@prisma/client";
import type {
  CreateTicketRequest,
  UpdateTicketRequest,
  TicketWithDetails,
  TicketDetail,
} from "@/types/roadmap";
import { validateFeatureAccess, validateTicketAccess } from "./utils";

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
      createdAt: true,
      updatedAt: true,
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
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
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      updatedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  if (!ticketDetail) {
    throw new Error("Ticket not found");
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

  if (data.status && !Object.values(TicketStatus).includes(data.status)) {
    throw new Error(
      `Invalid status. Must be one of: ${Object.values(TicketStatus).join(", ")}`
    );
  }

  if (data.priority && !Object.values(Priority).includes(data.priority)) {
    throw new Error(
      `Invalid priority. Must be one of: ${Object.values(Priority).join(", ")}`
    );
  }

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
    const assignee = await db.user.findUnique({
      where: { id: data.assigneeId },
    });

    if (!assignee) {
      throw new Error("Assignee not found");
    }
  }

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const maxOrderTicket = await db.ticket.findFirst({
    where: {
      featureId,
      phaseId: data.phaseId || null,
    },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const nextOrder = (maxOrderTicket?.order ?? -1) + 1;

  const ticket = await db.ticket.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      featureId,
      phaseId: data.phaseId || null,
      status: data.status || TicketStatus.TODO,
      priority: data.priority || Priority.MEDIUM,
      order: nextOrder,
      assigneeId: data.assigneeId || null,
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
      createdAt: true,
      updatedAt: true,
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

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
    if (!Object.values(TicketStatus).includes(data.status)) {
      throw new Error(
        `Invalid status. Must be one of: ${Object.values(TicketStatus).join(", ")}`
      );
    }
    updateData.status = data.status;
  }

  if (data.priority !== undefined) {
    if (!Object.values(Priority).includes(data.priority)) {
      throw new Error(
        `Invalid priority. Must be one of: ${Object.values(Priority).join(", ")}`
      );
    }
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
      const assignee = await db.user.findUnique({
        where: { id: data.assigneeId },
      });

      if (!assignee) {
        throw new Error("Assignee not found");
      }
    }
    updateData.assigneeId = data.assigneeId;
  }

  if (data.order !== undefined) {
    if (typeof data.order !== "number") {
      throw new Error("Order must be a number");
    }
    updateData.order = data.order;
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
      createdAt: true,
      updatedAt: true,
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return updatedTicket;
}

/**
 * Deletes a ticket
 */
export async function deleteTicket(
  ticketId: string,
  userId: string
): Promise<void> {
  const ticket = await validateTicketAccess(ticketId, userId);
  if (!ticket) {
    throw new Error("Ticket not found or access denied");
  }

  await db.ticket.delete({
    where: { id: ticketId },
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
    where: { featureId: firstTicket.featureId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      createdAt: true,
      updatedAt: true,
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
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

  return updatedTickets;
}
