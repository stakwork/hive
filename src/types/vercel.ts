/**
 * Vercel Log Drain Types
 * Documentation: https://vercel.com/docs/observability/log-drains
 */

/**
 * Vercel log entry from NDJSON log drain
 */
export interface VercelLogEntry {
  id: string;
  message: string;
  timestamp: number; // Unix timestamp in milliseconds
  source: "build" | "static" | "lambda" | "edge" | "external";
  
  // Project and deployment info
  projectId?: string;
  deploymentId?: string;
  
  // Request info (for proxy logs)
  host?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  
  // Client info
  clientIp?: string;
  userAgent?: string;
  
  // Additional fields
  proxy?: {
    timestamp: number;
    method: string;
    scheme: string;
    host: string;
    path: string;
    userAgent: string;
    referer: string;
    statusCode: number;
    clientIp: string;
    region: string;
    cacheId?: string;
    [key: string]: any;
  };
  
  [key: string]: any;
}

/**
 * Parsed NDJSON payload containing multiple log entries
 */
export type VercelLogPayload = VercelLogEntry[];
