/**
 * Startup Validation Orchestrator
 * 
 * Coordinates environment validation across the application startup process.
 * Provides hooks for Next.js API routes, middleware, and application initialization.
 */

import { validateEnvironmentVariablesOrThrow, type ValidationResult } from './env-validation';
import { ENV_VALIDATION_ERRORS } from './constants';

export interface StartupValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  timestamp: string;
}

/**
 * Performs complete startup validation
 */
export async function performStartupValidation(): Promise<StartupValidationResult> {
  const timestamp = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 1. Environment Variables Validation
    console.log('🔍 Starting environment variable validation...');
    const envResult = validateEnvironmentVariablesOrThrow();
    
    if (envResult.warnings.length > 0) {
      envResult.warnings.forEach(warning => {
        warnings.push(`Environment Warning: ${warning.error}`);
      });
    }

    // 2. Database Connection Validation (if applicable)
    if (process.env.DATABASE_URL) {
      try {
        console.log('🔍 Validating database connection...');
        await validateDatabaseConnection();
      } catch (error) {
        errors.push(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // 3. External Service Validation (if configured)
    await validateExternalServices(warnings);

    console.log('✅ Startup validation completed successfully');
    
    return {
      success: errors.length === 0,
      errors,
      warnings,
      timestamp
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown startup validation error';
    errors.push(errorMessage);
    
    console.error('❌ Startup validation failed:', errorMessage);
    
    return {
      success: false,
      errors,
      warnings,
      timestamp
    };
  }
}

/**
 * Validates database connection without importing heavy database libraries
 */
async function validateDatabaseConnection(): Promise<void> {
  // Basic connection string validation
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required but not set');
  }

  // Validate URL format
  try {
    const url = new URL(dbUrl);
    const supportedProtocols = ['postgresql:', 'mysql:', 'sqlite:', 'mongodb:'];
    
    if (!supportedProtocols.includes(url.protocol)) {
      throw new Error(`Unsupported database protocol: ${url.protocol}. Supported: ${supportedProtocols.join(', ')}`);
    }

    // Basic connectivity check for network databases
    if (['postgresql:', 'mysql:', 'mongodb:'].includes(url.protocol)) {
      if (!url.hostname || url.hostname === 'localhost' && !url.port) {
        console.warn('⚠️  Database URL points to localhost without explicit port - ensure database is running');
      }
    }
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error instanceof Error ? error.message : 'Invalid URL'}`);
  }
}

/**
 * Validates external service configuration
 */
async function validateExternalServices(warnings: string[]): Promise<void> {
  // GitHub OAuth validation
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  
  if (githubClientId && !githubClientSecret) {
    warnings.push('GitHub Client ID is set but Client Secret is missing - OAuth will not work');
  } else if (!githubClientId && githubClientSecret) {
    warnings.push('GitHub Client Secret is set but Client ID is missing - OAuth will not work');
  }

  // Stakwork API validation
  const stakworkApiKey = process.env.STAKWORK_API_KEY;
  if (stakworkApiKey && stakworkApiKey.length < 20) {
    warnings.push('Stakwork API key appears to be too short - integration may fail');
  }

  // Redis validation
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      new URL(redisUrl);
    } catch {
      warnings.push('Redis URL format appears invalid - caching may not work');
    }
  }
}

/**
 * Creates a startup validation middleware for Next.js API routes
 */
export function createApiValidationMiddleware() {
  return async function validateApiStartup() {
    try {
      validateEnvironmentVariablesOrThrow();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Environment validation failed',
        code: ENV_VALIDATION_ERRORS.VALIDATION_FAILED
      };
    }
  };
}

/**
 * Validates environment for specific feature requirements
 */
export function validateFeatureRequirements(feature: string): boolean {
  switch (feature) {
    case 'auth':
      return !!(process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_URL && process.env.JWT_SECRET);
    
    case 'database':
      return !!process.env.DATABASE_URL;
    
    case 'github-oauth':
      return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    
    case 'stakwork-integration':
      return !!process.env.STAKWORK_API_KEY;
    
    case 'redis-cache':
      return !!process.env.REDIS_URL;
    
    default:
      return true;
  }
}

/**
 * Gets startup validation status for health checks
 */
export function getValidationStatus(): StartupValidationResult {
  try {
    validateEnvironmentVariablesOrThrow();
    
    return {
      success: true,
      errors: [],
      warnings: [],
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Validation failed'],
      warnings: [],
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Startup validation hook for application initialization
 */
export async function initializeApplicationValidation(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    // Skip full validation in test environment
    return;
  }

  const result = await performStartupValidation();
  
  if (!result.success) {
    const errorMessage = [
      '❌ Application startup validation failed:',
      ...result.errors.map(e => `  • ${e}`),
      '',
      'Please fix these issues before starting the application.'
    ].join('\n');
    
    console.error(errorMessage);
    
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      throw new Error('Startup validation failed in development mode');
    }
  }

  if (result.warnings.length > 0) {
    console.warn('⚠️  Startup validation warnings:');
    result.warnings.forEach(warning => console.warn(`  • ${warning}`));
  }
}

/**
 * Runtime validation check for critical operations
 */
export function validateRuntimeRequirements(operation: string): void {
  const requirements: Record<string, () => boolean> = {
    'database-operation': () => validateFeatureRequirements('database'),
    'user-authentication': () => validateFeatureRequirements('auth'),
    'oauth-login': () => validateFeatureRequirements('github-oauth'),
    'stakwork-api': () => validateFeatureRequirements('stakwork-integration'),
    'cache-operation': () => validateFeatureRequirements('redis-cache')
  };

  const validator = requirements[operation];
  if (validator && !validator()) {
    throw new Error(`Runtime validation failed: ${operation} requirements not met. Check environment configuration.`);
  }
}