export type ThinkingStepState = 'pending' | 'running' | 'complete' | 'failed';

export interface ThinkingArtifact {
  stepId: string;
  stepName: string;
  log?: string;
  output?: string;
  stepState?: ThinkingStepState;
}

export interface ThinkingArtifactsResponse {
  artifacts: ThinkingArtifact[];
  runId: string;
  projectId?: string;
}
