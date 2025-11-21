/**
 * URL Validation Utility
 * Provides SSRF protection by validating URL schemes and blocking private IP ranges
 */

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Private IP ranges to block for SSRF protection
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,           // Loopback (127.0.0.0/8)
  /^10\./,            // Private network (10.0.0.0/8)
  /^192\.168\./,      // Private network (192.168.0.0/16)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private network (172.16.0.0/12)
  /^169\.254\./,      // Link-local (169.254.0.0/16)
  /^0\.0\.0\.0$/,     // Wildcard
];

/**
 * Special hostnames to block
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  '0.0.0.0',
  '::1',              // IPv6 loopback
  '169.254.169.254',  // AWS metadata endpoint
];

/**
 * Checks if a URL points to a private IP address or blocked hostname
 */
export function isPrivateIP(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Check blocked hostnames
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return true;
    }

    // Check private IP patterns
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return true;
      }
    }

    // Check for IPv6 loopback variations
    if (hostname === '::1' || hostname === '[::1]') {
      return true;
    }

    return false;
  } catch {
    // If URL parsing fails, consider it invalid/private for safety
    return true;
  }
}

/**
 * Validates external URLs for SSRF protection
 * - Only allows HTTP/HTTPS protocols
 * - Blocks private IP addresses
 * - Blocks localhost and metadata endpoints
 */
export function validateExternalUrl(url: string): ValidationResult {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required and must be a string' };
  }

  try {
    const parsed = new URL(url);

    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { 
        valid: false, 
        error: `Protocol '${parsed.protocol}' not allowed. Only HTTP and HTTPS are permitted.` 
      };
    }

    // Block private IPs and local addresses
    if (isPrivateIP(url)) {
      return { 
        valid: false, 
        error: 'Private IP addresses, localhost, and metadata endpoints are not allowed' 
      };
    }

    return { valid: true };
  } catch (error) {
    return { 
      valid: false, 
      error: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Returns the list of allowed domains for iframe embedding
 * Can be extended via environment variable ALLOWED_IFRAME_DOMAINS (comma-separated)
 */
export function getAllowedDomains(): string[] {
  const defaultDomains = [
    'sphinx.chat',
    'workspaces.sphinx.chat',
  ];
  
  // Allow extending via environment variable
  const envDomains = process.env.NEXT_PUBLIC_ALLOWED_IFRAME_DOMAINS;
  if (envDomains) {
    const additionalDomains = envDomains.split(',').map(d => d.trim()).filter(Boolean);
    return [...defaultDomains, ...additionalDomains];
  }
  
  return defaultDomains;
}

/**
 * Checks if a URL's domain is in the allowed list
 * Supports exact matches and subdomain wildcards
 */
export function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    return allowedDomains.some(domain => {
      const normalizedDomain = domain.toLowerCase();
      
      // Exact match
      if (hostname === normalizedDomain) {
        return true;
      }
      
      // Subdomain match (e.g., *.example.com matches sub.example.com)
      if (hostname.endsWith(`.${normalizedDomain}`)) {
        return true;
      }
      
      return false;
    });
  } catch {
    return false;
  }
}