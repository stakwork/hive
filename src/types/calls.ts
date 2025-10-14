export interface CallRecording {
  ref_id: string;
  episode_title: string;
  date_added_to_graph: number;
}

export interface CallsResponse {
  calls: CallRecording[];
  total: number;
  hasMore: boolean;
}

export interface JarvisNode {
  ref_id: string;
  node_type: string;
  date_added_to_graph: number;
  properties: {
    episode_title: string;
    media_url: string;
    source_link: string;
  };
}

export interface JarvisSearchResponse {
  nodes: JarvisNode[];
  edges: unknown[];
}
