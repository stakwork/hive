import { optionalEnvVars } from "@/lib/env";

/**
 * CORS Configuration and Utilities
 * 
 * This module provides utilities for Cross-Origin Resource Sharing (CORS) policy enforcement.
 * It works as an ADDITIONAL security layer on top of the existing cryptographic verification
 * and session-based authentication.
 * 
 * Key Principles:
 * - Webhook routes (server-to-server) should NOT have CORS headers
 * - Only browser-facing API routes need CORS for cross-origin requests
 * - Domain whitelist is environment-based for flexibility across deployments
 * - CORS does NOT replace existing security measures (HMAC signatures, sessions)
 */

export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAge: number;
  credentials: boolean;
}

/**
 * Default CORS configuration
 */
const DEFAULT_CORS_CONFIG: CorsConfig = {
  allowedOrigins: [],
  allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400, // 24 hours
  credentials: true,
};

/**
 * Parse trusted domains from environment variable
 * Format: "https://app.example.com,https://dashboard.example.com"
 */
export function getTrustedDomains(): string[] {
  const trustedDomains = optionalEnvVars.TRUSTED_DOMAINS;
  
  if (!trustedDomains || trustedDomains.trim() === "") {
    return [];
  }

  return trustedDomains
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => {
      // Validate domain format (must include protocol)
      try {
        new URL(domain);
        return true;
      } catch {
        console.warn(`[CORS] Invalid trusted domain format: ${domain}`);
        return false;
      }
    });
}

/**
 * Check if CORS is enabled via environment variable
 */
export function isCorsEnabled(): boolean {
  return optionalEnvVars.ENABLE_CORS === true;
}

/**
 * Validate if an origin is in the trusted domains list
 * Performs exact match comparison (case-sensitive)
 */
export function isOriginTrusted(origin: string | null, trustedDomains: string[]): boolean {
  if (!origin) {
    return false;
  }

  // Normalize origin (remove trailing slash if present)
  const normalizedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;

  return trustedDomains.some((trusted) => {
    const normalizedTrusted = trusted.endsWith("/") ? trusted.slice(0, -1) : trusted;
    return normalizedOrigin === normalizedTrusted;
  });
}

/**
 * Generate CORS headers for a valid origin
 * Returns an object of headers to be added to the response
 */
export function generateCorsHeaders(origin: string, config: CorsConfig = DEFAULT_CORS_CONFIG): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": config.allowedMethods.join(", "),
    "Access-Control-Allow-Headers": config.allowedHeaders.join(", "),
    "Access-Control-Max-Age": config.maxAge.toString(),
    ...(config.credentials && { "Access-Control-Allow-Credentials": "true" }),
  };
}

/**
 * Get CORS headers for a request origin
 * Returns headers object if origin is trusted and CORS is enabled, otherwise returns null
 */
export function getCorsHeaders(origin: string | null): Record<string, string> | null {
  if (!isCorsEnabled()) {
    return null;
  }

  const trustedDomains = getTrustedDomains();
  
  if (trustedDomains.length === 0) {
    console.warn("[CORS] ENABLE_CORS is true but TRUSTED_DOMAINS is not configured");
    return null;
  }

  if (!isOriginTrusted(origin, trustedDomains)) {
    return null;
  }

  return generateCorsHeaders(origin!);
}

/**
 * Check if a route should have CORS headers
 * Webhook routes (server-to-server) should be excluded
 */
export function shouldApplyCors(pathname: string): boolean {
  // Webhook routes receive server-to-server requests, not browser requests
  const webhookPrefixes = [
    "/api/github/webhook",
    "/api/stakwork/webhook",
    "/api/webhook/stakwork",
    "/api/janitors/webhook",
    "/api/swarm/stakgraph/webhook",
    "/api/chat/response",
  ];

  return !webhookPrefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Get default CORS configuration
 */
export function getDefaultCorsConfig(): CorsConfig {
  return { ...DEFAULT_CORS_CONFIG };
}