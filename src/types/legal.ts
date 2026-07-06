export interface LegalBenchmarkRun {
  id: string;
  workspaceId: string;
  taskSlug: string;
  taskTitle: string;
  status: "PENDING" | "RUNNING" | "SCORING" | "COMPLETE" | "FAILED";
  runnerProjectId: number | null;
  scorerProjectId: number | null;
  runnerOutputUrl: string | null;
  runnerOutputText: string | null;
  scoreJson: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RubricScore {
  criterion: string;
  pass: boolean;
  notes: string;
}
