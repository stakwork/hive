export interface CallRecording {
  ref_id: string;
  episode_title: string;
  date_added_to_graph: number;
  description?: string;
  source_link?: string;
  media_url?: string;
  image_url?: string;
}

export interface CallsResponse {
  calls: CallRecording[];
  total: number;
  hasMore: boolean;
}

export interface JarvisNode {
  ref_id: string;
  node_type: string;
  date_added_to_graph?: number; // Mark as optional since it might be missing
  properties?: {                // Mark properties as optional
    episode_title?: string;     // Mark as optional since it might be missing
    media_url?: string;
    source_link?: string;
    description?: string;
  };
}

export interface JarvisSearchResponse {
  nodes: JarvisNode[];
  edges: unknown[];
}
