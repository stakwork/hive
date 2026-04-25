export interface MilestoneResponse {
  id: string;
  initiativeId: string;
  name: string;
  description: string | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  sequence: number;
  dueDate: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeResponse {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
  assignee: { id: string; name: string | null } | null;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  milestones: MilestoneResponse[];
}
