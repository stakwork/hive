export type NodeType = 
  | "Page" | "Function" | "Class" | "Trait" | "Datamodel" 
  | "Request" | "Endpoint" | "Test" | "E2etest" | "Var" 
  | "Message" | "Person" | "Video";

export interface CodeGraphNode {
  node_type: NodeType;
  ref_id: string;
  properties: {
    token_count: number;
    file: string;
    node_key: string;
    name: string;
    start: number;
    end: number;
    body: string;
    language?: string;
  };
}

export interface CodeGraphEdge {
  from: string;
  to: string;
  type: string;
}

export interface SearchParams {
  query: string;
  method?: "fulltext" | "vector";
  concise?: boolean;
  node_types?: NodeType[];
  limit?: number;
  max_tokens?: number;
  language?: string;
}

export interface NodesParams {
  node_type?: NodeType;
  concise?: boolean;
  ref_ids?: string;
  language?: string;
}


export class CodeGraphService {
  private workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  private async fetchJson<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
    const searchParams = new URLSearchParams({
      ...params,
      workspaceId: this.workspaceId,
    });

    // Clean up undefined/null values
    for (const [key, value] of searchParams.entries()) {
      if (value === 'undefined' || value === 'null' || value === '') {
        searchParams.delete(key);
      }
    }

    const url = `/api/codegraph${endpoint}?${searchParams.toString()}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'API request failed');
      }
      return result.data;
    } catch (error) {
      console.error(`CodeGraph API Error (${endpoint}):`, error);
      throw error;
    }
  }

  async search(params: SearchParams): Promise<CodeGraphNode[]> {
    const queryParams: Record<string, any> = {
      query: params.query,
      method: params.method || 'fulltext',
      concise: params.concise || false,
      limit: params.limit || 25,
      max_tokens: params.max_tokens || 100000,
    };

    if (params.node_types?.length) {
      queryParams.node_types = params.node_types.join(',');
    }

    if (params.language) {
      queryParams.language = params.language;
    }

    return this.fetchJson<CodeGraphNode[]>('/search', queryParams);
  }

  async getNodes(params: NodesParams = {}): Promise<CodeGraphNode[]> {
    const queryParams: Record<string, any> = {};

    if (params.node_type) {
      queryParams.node_type = params.node_type;
    }

    if (params.concise !== undefined) {
      queryParams.concise = params.concise;
    }

    if (params.ref_ids) {
      queryParams.ref_ids = params.ref_ids;
    }

    if (params.language) {
      queryParams.language = params.language;
    }

    return this.fetchJson<CodeGraphNode[]>('/nodes', queryParams);
  }


  // Helper method to get all functions
  async getFunctions(language?: string): Promise<CodeGraphNode[]> {
    return this.getNodes({ 
      node_type: 'Function', 
      language 
    });
  }

  // Helper method to get all classes
  async getClasses(language?: string): Promise<CodeGraphNode[]> {
    return this.getNodes({ 
      node_type: 'Class', 
      language 
    });
  }

  // Helper method to search functions specifically
  async searchFunctions(query: string, method: "fulltext" | "vector" = 'fulltext'): Promise<CodeGraphNode[]> {
    return this.search({
      query,
      method,
      node_types: ['Function'],
      limit: 50
    });
  }
}