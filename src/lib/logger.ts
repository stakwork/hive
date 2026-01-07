// Log levels with numeric values for comparison
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

// Get log level from environment or default to INFO
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  switch (envLevel) {
    case 'ERROR': return LogLevel.ERROR;
    case 'WARN': return LogLevel.WARN;
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO':
    default: return LogLevel.INFO;
  }
};

// Sensitive field patterns that should be sanitized
const SENSITIVE_PATTERNS = [
  /access_token/i,
  /refresh_token/i,
  /id_token/i,
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /session[_-]?state/i,
  /provider[_-]?account[_-]?id/i,
];

// Sensitive object keys that should be completely redacted
const SENSITIVE_KEYS = new Set([
  'access_token',
  'refresh_token', 
  'id_token',
  'apiKey',
  'api_key',
  'secret',
  'password',
  'token',
  'authorization',
  'session_state',
  'providerAccountId',
]);

// Email pattern for partial masking
const EMAIL_PATTERN = /^([^@]{1,2})[^@]*@([^.]+\.)*[^.]+$/;

/**
 * Sanitizes sensitive data from objects, arrays, and strings
 */
function sanitizeData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Check for token-like strings (long alphanumeric strings)
    if (data.length > 20 && /^[a-zA-Z0-9._-]+$/.test(data)) {
      return `${data.substring(0, 4)}***${data.substring(data.length - 4)}`;
    }
    
    // Mask email addresses
    if (EMAIL_PATTERN.test(data)) {
      return data.replace(EMAIL_PATTERN, (match, p1, p2) => {
        return `${p1}***@${p2 ? '***.' : ''}***`;
      });
    }
    
    // Check for sensitive patterns in strings
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(data)) {
        return data.length > 10 ? `${data.substring(0, 4)}***REDACTED***` : '***REDACTED***';
      }
    }
    
    return data;
  }

  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      return data.map(item => sanitizeData(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Check if key is sensitive
      if (SENSITIVE_KEYS.has(key.toLowerCase()) || 
          SENSITIVE_PATTERNS.some(pattern => pattern.test(key))) {
        sanitized[key] = value ? '***REDACTED***' : value;
      } else {
        sanitized[key] = sanitizeData(value);
      }
    }
    return sanitized;
  }

  return data;
}

/**
 * Structured logger class with sanitization
 */
class StructuredLogger {
  private currentLevel: LogLevel;

  constructor() {
    this.currentLevel = getLogLevel();
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  private formatMessage(level: string, message: string, context?: string, metadata?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(context && { context }),
      ...(metadata && { metadata: sanitizeData(metadata) }),
    };

    // Use console methods based on level
    switch (level) {
      case 'ERROR':
        console.error(JSON.stringify(logEntry, null, 2));
        break;
      case 'WARN':
        console.warn(JSON.stringify(logEntry, null, 2));
        break;
      case 'INFO':
        console.info(JSON.stringify(logEntry, null, 2));
        break;
      case 'DEBUG':
        console.debug(JSON.stringify(logEntry, null, 2));
        break;
      default:
        console.log(JSON.stringify(logEntry, null, 2));
    }
  }

  error(message: string, context?: string, metadata?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.formatMessage('ERROR', message, context, metadata);
    }
  }

  warn(message: string, context?: string, metadata?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.formatMessage('WARN', message, context, metadata);
    }
  }

  info(message: string, context?: string, metadata?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.formatMessage('INFO', message, context, metadata);
    }
  }

  debug(message: string, context?: string, metadata?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.formatMessage('DEBUG', message, context, metadata);
    }
  }

  /**
   * Authentication-specific logging with enhanced sanitization
   */
  authError(message: string, context: string, error?: any): void {
    const sanitizedError = error ? {
      message: error.message,
      code: error.code,
      status: error.status,
      name: error.name,
      // Exclude stack trace and other potentially sensitive details
    } : undefined;

    this.error(message, `AUTH:${context}`, sanitizedError);
  }

  authWarn(message: string, context: string, metadata?: any): void {
    this.warn(message, `AUTH:${context}`, metadata);
  }

  authInfo(message: string, context: string, metadata?: any): void {
    this.info(message, `AUTH:${context}`, metadata);
  }

  authDebug(message: string, context: string, metadata?: any): void {
    this.debug(message, `AUTH:${context}`, metadata);
  }
}

// Export singleton instance
export const logger = new StructuredLogger();

// Export sanitization utility for external use
export { sanitizeData };
