// Common API response types
export interface ApiResponse<T = object> {
  data?: T;
  error?: string;
  message?: string;
  status: number;
}

// Common request/response patterns
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
}

// Common error types
export interface ApiError {
  message: string;
  status: number;
  service: string;
  details?: object;
  code?: string;
}

// Common service configuration
export interface ServiceConfig {
  baseURL: string;
  apiKey: string;
  timeout?: number;
  headers?: Record<string, string>;
}

// Common service interface
export interface BaseService {
  readonly serviceName: string;
  getConfig(): ServiceConfig;
  updateApiKey(apiKey: string): void;
}

export interface SwarmService {
  readonly serviceName: string;
  getConfig(): ServiceConfig;
}
