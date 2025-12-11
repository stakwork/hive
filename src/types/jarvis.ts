// Shared types for Jarvis API responses

export interface JarvisNode {
  ref_id: string;
  node_type: string;
  properties?: {
    media_url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JarvisResponse {
  nodes?: JarvisNode[];
  edges?: unknown[];
  [key: string]: unknown;
}

export interface UpdateNodeRequest {
  ref_id: string;
  properties: Record<string, unknown>;
}

export interface JarvisConnectionConfig {
  jarvisUrl: string;
  apiKey: string;
}
