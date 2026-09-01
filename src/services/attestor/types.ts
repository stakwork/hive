export interface Criterion {
  id: string;
  text: string;
}

export type CriterionStatus = "met" | "not_met" | "pending";

export type VerifyOverall = "passed" | "failed" | "pending";

export interface ChecklistItem {
  id: string;
  text: string;
  status: CriterionStatus;
  evidence: string | null;
  cause: string | null;
}

export interface VerifyHints {
  login?: string;
  startPath?: string;
  notes?: string;
}

export interface VerifyModel {
  apiKey: string;
  host?: string;
  provider?: string;
  model?: string;
}

export interface VerifyRequest {
  featureId: string;
  frontendUrl: string;
  criteria: Criterion[];
  hints: VerifyHints;
  model: VerifyModel;
  responseUrl: string;
  callbackApiKey: string;
}

export interface VerifyCallbackPayload {
  featureId: string;
  overall: VerifyOverall;
  checklist: ChecklistItem[];
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export interface StartVerificationResult {
  featureId: string;
  status: "running";
  criteriaCount: number;
  frontendUrl: string | null;
  podStatus: "claimed" | "local";
}
