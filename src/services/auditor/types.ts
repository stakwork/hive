export interface DeckTask {
  prompt: string;
  description: string;
}

export interface DeckMap {
  appUrl: string;
  notes: string | null;
}

export interface Deck {
  task: DeckTask;
  diff: string;
  featureContext: string;
  map: DeckMap;
}

export interface AuditModel {
  apiKey: string;
  host?: string;
  provider?: string;
  model?: string;
}

export interface AuditJobBody {
  taskId: string;
  deck: Deck;
  model: AuditModel;
  responseUrl: string;
  callbackApiKey: string;
}

export type AuditOverall = "works" | "broken" | "unknown";

export interface AuditClaim {
  claim: string;
  verdict: string;
  proof: string[];
  reasoning: string;
}

export type AuditEvidenceKind = "screenshot" | "http" | "log" | "timing" | "dom" | "note";

export interface AuditEvidence {
  id: string;
  kind: AuditEvidenceKind;
  summary: string;
  data: string;
}

export interface AuditVerdict {
  taskId: string;
  overall: AuditOverall;
  claims: AuditClaim[];
  observations: string[];
  summary: string;
  evidence?: AuditEvidence[];
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export interface StartAuditResult {
  success: boolean;
  taskId: string;
  podId?: string;
  appUrl?: string;
  error?: string;
}
